let limitePicoUI = 1000;
let ultimoTimestampGrafico = null;

const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

function apiUrl(caminho) {
    return `${API_BASE}${caminho}`;
}

function numeroFinito(valor, padrao = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : padrao;
}

function formatarNumero(valor, casas = 2) {
    return numeroFinito(valor).toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: casas,
    });
}

function atualizarValorComUnidade(id, valor, unidade, casas = 2) {
    const elemento = document.getElementById(id);
    elemento.innerHTML = `${formatarNumero(valor, casas)} <span class="metric-unit">${unidade}</span>`;
}

function atualizarStatusConexao(conectado) {
    const badge = document.getElementById('status-conexao');

    if (conectado) {
        badge.textContent = 'Conectado ao Servidor';
        badge.className = 'status-pill is-online';
        return;
    }

    badge.textContent = 'Desconectado do Servidor';
    badge.className = 'status-pill';
}

function mostrarMensagemLimite(texto, sucesso = true) {
    const mensagem = document.getElementById('msg-limite');
    mensagem.textContent = texto;
    mensagem.className = `limit-message is-visible ${sucesso ? '' : 'is-error'}`;

    setTimeout(() => {
        mensagem.classList.remove('is-visible');

    }, 2500);
}

Chart.defaults.color = '#586f8a';
Chart.defaults.font.family = '"Segoe UI", sans-serif';
Chart.defaults.plugins.legend.display = false;
Chart.defaults.animation = false;

const ctx = document.getElementById('graficoPotencia').getContext('2d');
const graficoPotencia = new Chart(ctx, {
    type: 'line',
    data: {
        labels: [],
        datasets: [{
            label: 'Potência (W)',
            data: [],
            borderColor: '#2164cf',
            backgroundColor: 'rgba(33, 100, 207, 0.09)',
            borderWidth: 2,
            fill: true,
            tension: 0.15,
            pointRadius: 0,
            pointHitRadius: 12,
        }],
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
        datasets: [{
            label: 'Consumo no período (kWh)',
            data: [],
            borderColor: '#2164cf',
            backgroundColor: 'rgba(33, 100, 207, 0.09)',
            borderWidth: 2,
            fill: true,
            tension: 0.15,
            pointRadius: 0,
            pointHitRadius: 12,
        }],
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
        grafico.data.datasets[0].backgroundColor = escuro ? 'rgba(132, 184, 255, .1)' : 'rgba(33, 100, 207, .09)';
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

async function carregarHistoricoInicial() {
    try {
        const resposta = await fetch(apiUrl('/api/historico'));
        if (!resposta.ok) throw new Error('Falha ao buscar historico');

        const historico = await resposta.json();

        graficoPotencia.data.labels = [];
        graficoPotencia.data.datasets[0].data = [];

        historico.forEach((registro) => {
            const horaFormatada = new Date(registro.timestamp).toLocaleTimeString('pt-BR');
            graficoPotencia.data.labels.push(horaFormatada);
            graficoPotencia.data.datasets[0].data.push(numeroFinito(registro.potencia));
            ultimoTimestampGrafico = registro.timestamp;
        });

        graficoPotencia.update();
    } catch (e) {
        console.log('Ainda nao ha historico ou o servidor esta offline.');
    }
}

async function carregarLimite() {
    try {
        const resposta = await fetch(apiUrl('/api/config/limite'));
        if (!resposta.ok) throw new Error('Falha ao buscar limite');

        const dados = await resposta.json();
        limitePicoUI = numeroFinito(dados.limite, limitePicoUI);
        document.getElementById('input-limite').value = limitePicoUI;
    } catch (e) {
        console.error('Erro ao carregar limite de pico:', e);
    }
}

async function atualizarDados() {
    try {
        const resposta = await fetch(apiUrl('/api/status'));
        if (!resposta.ok) throw new Error('Servidor retornou erro');

        const dados = await resposta.json();
        const potenciaAtual = numeroFinito(dados.potencia);
        if (typeof window.atualizarControleTensao === 'function') window.atualizarControleTensao(dados);
        const emAlerta = Boolean(dados.statusAlerta) || potenciaAtual > limitePicoUI;

        atualizarStatusConexao(true);
        const leitura = dados.timestampLeitura || dados.timestamp;
        document.getElementById('ultima-leitura').textContent = leitura
            ? `Última leitura às ${new Date(leitura).toLocaleTimeString('pt-BR')}`
            : 'Aguardando primeira leitura';
        atualizarValorComUnidade('val-tensao', dados.tensao, 'V', 1);
        const saida = document.getElementById('val-tensao-saida');
        if (typeof dados.tensaoSaida === 'number' && Number.isFinite(dados.tensaoSaida)) {
            atualizarValorComUnidade('val-tensao-saida', dados.tensaoSaida, 'V', 2);
            saida.title = 'Tensão de saída medida pelo ESP32';
        } else {
            saida.innerHTML = '— <span class="metric-unit">V</span>';
            saida.title = 'Leitura ainda não recebida';
        }
        atualizarValorComUnidade('val-corrente', dados.corrente, 'A', 2);
        atualizarValorComUnidade('val-potencia', potenciaAtual, 'W', 1);
        atualizarValorComUnidade('val-kwh', dados.consumoKWh, 'kWh', 4);

        const alertaDiv = document.getElementById('alerta-pico');
        alertaDiv.classList.toggle('hidden', !emAlerta);

        adicionarPontoPotencia(dados.timestampLeitura || dados.timestamp, potenciaAtual);
    } catch (erro) {
        atualizarStatusConexao(false);
        if (typeof window.atualizarControleTensao === 'function') {
            window.atualizarControleTensao({ controleTensao: { motivo: 'Sem conexão com o servidor.' } });
        }
    }
}

async function carregarConsumoDiario() {
    try {
        const resposta = await fetch(apiUrl('/api/consumo-diario'));
        if (!resposta.ok) throw new Error('Falha ao buscar consumo diario');

        const dados = await resposta.json();

        graficoConsumo.data.labels = dados.map((registro) => registro.horario);
        graficoConsumo.data.datasets[0].data = dados.map((registro) => numeroFinito(registro.consumo_total));

        graficoConsumo.update();
    } catch (e) {
        console.error('Erro ao buscar consumo diario:', e);
    }
}

async function carregarPicos() {
    try {
        const resposta = await fetch(apiUrl('/api/picos'));
        if (!resposta.ok) throw new Error('Falha ao buscar picos');

        const dados = await resposta.json();
        const picos = Array.isArray(dados.picos) ? dados.picos : [];

        limitePicoUI = numeroFinito(dados.limite, limitePicoUI);
        document.getElementById('input-limite').value = limitePicoUI;

        const titulo = document.getElementById('titulo-picos');
        if (titulo) {
            titulo.textContent = `Picos acima de ${formatarNumero(limitePicoUI, 0)} W`;
        }

        const lista = document.getElementById('listaPicos');
        lista.innerHTML = '';

        if (picos.length === 0) {
            lista.innerHTML = '<li class="empty-state">Nenhum pico registrado hoje.</li>';
            return;
        }

        picos.forEach((pico) => {
            const item = document.createElement('li');
            item.className = 'peak-item';
            item.textContent = `Pico de ${formatarNumero(pico.potencia, 1)}W registrado às ${pico.horario}`;
            lista.appendChild(item);
        });
    } catch (e) {
        console.error('Erro ao carregar os picos:', e);
    }
}

async function enviarComando(acao) {
    const feedback = document.getElementById('feedback-comando');
    feedback.textContent = `Enviando comando '${acao}'...`;
    feedback.className = 'feedback';

    try {
        const resposta = await fetch(apiUrl('/api/comando'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao }),
        });
        const resultado = await resposta.json();

        if (resposta.ok) {
            feedback.textContent = `Sucesso: ${resultado.mensagem}`;
            feedback.className = 'feedback success';
        } else {
            feedback.textContent = `Erro: ${resultado.erro}`;
            feedback.className = 'feedback error';
        }
    } catch (e) {
        feedback.textContent = 'Erro de conexao ao tentar enviar o comando.';
        feedback.className = 'feedback error';
    }
}

async function salvarNovoLimite() {
    const input = document.getElementById('input-limite');
    const novoLimite = Number(input.value);

    if (!Number.isFinite(novoLimite) || novoLimite <= 0) {
        mostrarMensagemLimite('Informe um limite maior que zero.', false);
        return;
    }

    try {
        const resposta = await fetch(apiUrl('/api/config/limite'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ novoLimite }),
        });
        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(resultado.erro || 'Falha ao salvar limite');
        }

        limitePicoUI = numeroFinito(resultado.limite, novoLimite);
        input.value = limitePicoUI;
        mostrarMensagemLimite('Limite salvo com sucesso.');
        await carregarPicos();
        await atualizarDados();
    } catch (e) {
        mostrarMensagemLimite(e.message || 'Erro ao salvar limite.', false);
    }
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

async function carregarPizzas() {
    try {
        const [resDiaria, resSemanal, resMensal] = await Promise.all([
            fetch(apiUrl('/api/consumo-diario')),
            fetch(apiUrl('/api/consumo-semanal')),
            fetch(apiUrl('/api/consumo-mensal')),
        ]);

        if (!resDiaria.ok || !resSemanal.ok || !resMensal.ok) throw new Error('Falha');

        const [dadosDiaria, dadosSemanal, dadosMensal] = await Promise.all([
            resDiaria.json(), resSemanal.json(), resMensal.json(),
        ]);

        preencherPizza(pizzaDiaria, dadosDiaria, 'horario', 'total-dia');
        preencherPizza(pizzaSemanal, dadosSemanal, 'data', 'total-semana');
        preencherPizza(pizzaMensal, dadosMensal, 'data', 'total-mes');
        const totalPeriodo = (dados) => Array.isArray(dados) && dados.length && dados.every((item) =>
            (typeof item.consumo_total === 'number' || (typeof item.consumo_total === 'string' && item.consumo_total.trim() !== '')) &&
            Number.isFinite(Number(item.consumo_total)) && Number(item.consumo_total) >= 0)
            ? dados.reduce((total, item) => total + Number(item.consumo_total), 0) : null;
        window.atualizarConsumoCustos?.({
            dia: totalPeriodo(dadosDiaria),
            semana: totalPeriodo(dadosSemanal),
            mes: totalPeriodo(dadosMensal),
        });
    } catch (e) {
        window.atualizarConsumoCustos?.(null);
        console.error('Erro ao carregar graficos de pizza:', e);
    }
}

async function iniciarPainel() {
    await carregarLimite();
    await Promise.all([
        carregarHistoricoInicial(),
        carregarConsumoDiario(),
        carregarPicos(),
        carregarPizzas(),
        atualizarDados(),
    ]);
}

iniciarPainel();

setInterval(atualizarDados, 2000);

setInterval(() => {
    carregarConsumoDiario();
    carregarPicos();
    carregarPizzas();
}, 5000);

lucide.createIcons();