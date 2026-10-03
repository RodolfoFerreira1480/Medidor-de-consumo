async function carregarConsumoDiario() {
    try {
        const resposta = await fetch(apiUrl('/api/consumo-diario'));
        if (!resposta.ok) throw new Error('Falha ao buscar consumo diario');

        const dados = await resposta.json();

        graficoConsumo.data.labels = dados.map((registro) => registro.horario);
        graficoConsumo.data.datasets[0].data = dados.map((registro) =>
            numeroFinito(registro.consumo_total),
        );

        graficoConsumo.update();
    } catch (e) {
        console.error('Erro ao buscar consumo diario:', e);
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
            resDiaria.json(),
            resSemanal.json(),
            resMensal.json(),
        ]);

        preencherPizza(pizzaDiaria, dadosDiaria, 'horario', 'total-dia');
        preencherPizza(pizzaSemanal, dadosSemanal, 'data', 'total-semana');
        preencherPizza(pizzaMensal, dadosMensal, 'data', 'total-mes');
        const totalPeriodo = (dados) =>
            Array.isArray(dados) &&
            dados.length &&
            dados.every(
                (item) =>
                    (typeof item.consumo_total === 'number' ||
                        (typeof item.consumo_total === 'string' &&
                            item.consumo_total.trim() !== '')) &&
                    Number.isFinite(Number(item.consumo_total)) &&
                    Number(item.consumo_total) >= 0,
            )
                ? dados.reduce((total, item) => total + Number(item.consumo_total), 0)
                : null;
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
