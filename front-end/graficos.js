let ultimoTimestampGrafico = null;

Chart.defaults.color = '#586f8a';
Chart.defaults.font.family = '"Segoe UI", sans-serif';
Chart.defaults.plugins.legend.display = false;
Chart.defaults.animation = false;

const ctx = document.getElementById('graficoPotencia').getContext('2d');
const graficoPotencia = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Potência (W)',
                data: [],
                borderColor: '#2164cf',
                backgroundColor: 'rgba(33, 100, 207, 0.09)',
                borderWidth: 2,
                fill: true,
                tension: 0.15,
                pointRadius: 0,
                pointHitRadius: 12,
            },
        ],
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: { beginAtZero: true, grid: { color: '#d5e2f1' } },
            x: { grid: { display: false } },
        },
    },
});

const ctxDiario = document.getElementById('graficoConsumoDiario').getContext('2d');
const graficoConsumo = new Chart(ctxDiario, {
    type: 'line',
    data: {
        labels: [],
        datasets: [
            {
                label: 'Consumo no período (kWh)',
                data: [],
                borderColor: '#2164cf',
                backgroundColor: 'rgba(33, 100, 207, 0.09)',
                borderWidth: 2,
                fill: true,
                tension: 0.15,
                pointRadius: 0,
                pointHitRadius: 12,
            },
        ],
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: { beginAtZero: true, grid: { color: '#d5e2f1' } },
            x: { grid: { display: false } },
        },
    },
});

function gerarCoresConsumo(quantidade) {
    const coresBackground = [];
    const coresBorda = [];

    for (let i = 0; i < quantidade; i++) {
        const paleta = ['#2164cf', '#4989ec', '#7bb2fb', '#164a99', '#38a7d6', '#b1d3ff'];
        coresBackground.push(paleta[i % paleta.length]);
        coresBorda.push(document.documentElement?.dataset.theme === 'dark' ? '#10213a' : '#ffffff');
    }

    return { bg: coresBackground, border: coresBorda };
}

const configBasePizza = {
    type: 'doughnut',
    options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '80%',
        animation: {
            animateScale: true,
            easing: 'easeOutQuart',
            duration: 250,
        },
        plugins: {
            legend: { display: false },
        },
    },
};

const pizzaDiaria = new Chart(document.getElementById('pizzaDiaria').getContext('2d'), {
    ...configBasePizza,
    data: { labels: [], datasets: [{ data: [], borderWidth: 2 }] },
});

const pizzaSemanal = new Chart(document.getElementById('pizzaSemanal').getContext('2d'), {
    ...configBasePizza,
    data: { labels: [], datasets: [{ data: [], borderWidth: 2 }] },
});

const pizzaMensal = new Chart(document.getElementById('pizzaMensal').getContext('2d'), {
    ...configBasePizza,
    data: { labels: [], datasets: [{ data: [], borderWidth: 2 }] },
});

function atualizarTemaGraficos() {
    const escuro = document.documentElement?.dataset.theme === 'dark';
    const texto = escuro ? '#a1b6d3' : '#586f8a';
    const linha = escuro ? '#29415f' : '#d5e2f1';
    Chart.defaults.color = texto;
    for (const grafico of [graficoPotencia, graficoConsumo]) {
        grafico.data.datasets[0].borderColor = escuro ? '#84b8ff' : '#2164cf';
        grafico.data.datasets[0].backgroundColor = escuro
            ? 'rgba(132, 184, 255, .1)'
            : 'rgba(33, 100, 207, .09)';
        for (const eixo of Object.values(grafico.options.scales)) {
            eixo.ticks = { ...eixo.ticks, color: texto };
            eixo.grid.color = linha;
            eixo.border = { color: linha };
        }
        grafico.update('none');
    }
    for (const grafico of [pizzaDiaria, pizzaSemanal, pizzaMensal]) {
        grafico.data.datasets[0].borderColor = escuro ? '#10213a' : '#ffffff';
        grafico.update('none');
    }
}
window.addEventListener?.('themechange', atualizarTemaGraficos);
atualizarTemaGraficos();

function adicionarPontoPotencia(timestamp, potencia) {
    if (!timestamp || timestamp === ultimoTimestampGrafico) {
        return;
    }

    ultimoTimestampGrafico = timestamp;
    const horaAtual = new Date(timestamp).toLocaleTimeString('pt-BR');

    if (graficoPotencia.data.labels.length >= 20) {
        graficoPotencia.data.labels.shift();
        graficoPotencia.data.datasets[0].data.shift();
    }

    graficoPotencia.data.labels.push(horaAtual);
    graficoPotencia.data.datasets[0].data.push(numeroFinito(potencia));
    graficoPotencia.update();
}

function preencherPizza(grafico, dados, campoLabel, idTotal) {
    const cores = gerarCoresConsumo(dados.length);

    grafico.data.labels = dados.map((item) => item[campoLabel]);
    grafico.data.datasets[0].data = dados.map((item) => numeroFinito(item.consumo_total));
    grafico.data.datasets[0].backgroundColor = cores.bg;
    grafico.data.datasets[0].borderColor = cores.border;
    grafico.update();

    if (idTotal) {
        const total = dados.reduce((acc, curr) => acc + numeroFinito(curr.consumo_total), 0);
        document.getElementById(idTotal).textContent = formatarNumero(total, 1);
    }
}
