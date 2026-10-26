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

async function atualizarDados() {
    try {
        const resposta = await fetch(apiUrl('/api/status'));
        if (!resposta.ok) throw new Error('Servidor retornou erro');

        const dados = await resposta.json();
        const potenciaAtual = numeroFinito(dados.potencia);
        if (typeof window.atualizarControleTensao === 'function')
            window.atualizarControleTensao(dados);
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
            window.atualizarControleTensao({
                controleTensao: { motivo: 'Sem conexão com o servidor.' },
            });
        }
    }
}
