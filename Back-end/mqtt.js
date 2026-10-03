const { normalizarLeitura } = require('./medicoes');

function registrarEventosMqtt({
    mqttClient,
    estado,
    TOPIC_DADOS,
    TOPIC_ALERTA,
    salvarLeituraBanco,
    aplicarProtecaoPico,
}) {
    mqttClient.on('connect', () => {
        console.log('Conectado ao Broker MQTT com sucesso!');
        mqttClient.subscribe([TOPIC_DADOS, TOPIC_ALERTA], (err) => {
            if (err) {
                console.error('Erro ao se inscrever nos topicos MQTT:', err.message);
                return;
            }

            console.log(`Inscrito nos topicos: ${TOPIC_DADOS} e ${TOPIC_ALERTA}`);
        });
    });

    mqttClient.on('error', (err) => {
        console.error('Erro na conexao MQTT:', err.message);
    });

    // A reconexão exige nova telemetria; uma mensagem retida não prova que o ESP32 está online.
    mqttClient.on('close', () => {
        estado.leituraAoVivo = false;
    });

    mqttClient.on('message', async (topic, message, packet) => {
        const payload = message.toString();

        if (topic === TOPIC_DADOS) {
            let dadosRecebidos;

            try {
                dadosRecebidos = JSON.parse(payload);
                if (
                    !dadosRecebidos ||
                    typeof dadosRecebidos !== 'object' ||
                    Array.isArray(dadosRecebidos)
                )
                    return;
            } catch (e) {
                console.log('Erro ao analisar JSON dos dados:', payload);
                return;
            }

            try {
                const leitura = normalizarLeitura(dadosRecebidos);
                const limitePicoAtual = estado.ultimoEstado.limitePico;
                const timestamp = new Date();
                estado.leituraAoVivo = !packet?.retain;

                estado.ultimoEstado = {
                    ...leitura,
                    limitePico: limitePicoAtual,
                    statusAlerta: leitura.potencia > limitePicoAtual,
                    alerta: leitura.potencia > limitePicoAtual ? 'Pico de energia detectado' : null,
                    timestampLeitura: timestamp,
                    timestamp,
                };

                console.log('Dados recebidos do medidor:', estado.ultimoEstado);

                try {
                    await salvarLeituraBanco(leitura);
                    console.log('Dados salvos no PostgreSQL com sucesso.');
                } catch (dbErr) {
                    console.error('Erro ao salvar no banco:', dbErr.message);
                }

                await aplicarProtecaoPico(leitura, limitePicoAtual);
            } catch (e) {
                console.error('Erro ao processar dados do medidor:', e);
            }
        }

        if (topic === TOPIC_ALERTA) {
            estado.ultimoEstado = {
                ...estado.ultimoEstado,
                statusAlerta: true,
                alerta: payload,
                timestamp: new Date(),
            };

            console.log(`ALERTA DE PICO DE ENERGIA: ${payload}`);
        }
    });
}

module.exports = { registrarEventosMqtt };
