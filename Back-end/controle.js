function criarControle({ mqttClient, estado, TOPIC_COMANDO, VALIDADE_LEITURA_MS }) {
    function estadoControleTensao() {
        let motivo = '';
        if (!mqttClient.connected) motivo = 'Medidor sem conexão com o broker MQTT.';
        else if (
            !estado.leituraAoVivo ||
            !estado.ultimoEstado.timestampLeitura ||
            Date.now() - new Date(estado.ultimoEstado.timestampLeitura).getTime() >
                VALIDADE_LEITURA_MS
        ) {
            motivo = 'Aguardando uma leitura recente do ESP32.';
        } else if (!(estado.ultimoEstado.tensaoMaxima > 0)) {
            motivo = 'Aguardando a tensão máxima informada pelo ESP32.';
        }
        return { disponivel: !motivo, motivo };
    }

    function publicarComando(comando, parametros = {}) {
        return new Promise((resolve, reject) => {
            if (!mqttClient.connected) {
                reject(new Error('Broker MQTT desconectado'));
                return;
            }

            const prazo = setTimeout(
                () =>
                    reject(
                        new Error(
                            'Envio sem confirmação do broker. Confira a saída antes de tentar novamente.',
                        ),
                    ),
                8000,
            );
            prazo.unref?.();
            mqttClient.publish(
                TOPIC_COMANDO,
                JSON.stringify({ ...parametros, comando }),
                { qos: 1, retain: false },
                (err) => {
                    clearTimeout(prazo);
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve();
                },
            );
        });
    }

    async function aplicarProtecaoPico(leitura, limitePicoAtual) {
        const emPico = leitura.potencia > limitePicoAtual;

        if (!emPico && estado.desarmePorPicoAtivo && leitura.potencia <= limitePicoAtual * 0.95) {
            estado.desarmePorPicoAtivo = false;
        }

        if (!emPico || estado.desarmePorPicoAtivo) {
            return;
        }

        try {
            await publicarComando('desligar');
            estado.desarmePorPicoAtivo = true;
            console.log(
                `Protecao acionada: potencia ${leitura.potencia}W acima do limite ${limitePicoAtual}W.`,
            );
        } catch (err) {
            console.error('Falha ao enviar comando de desarme automatico:', err.message);
        }
    }

    return { estadoControleTensao, publicarComando, aplicarProtecaoPico };
}

module.exports = { criarControle };
