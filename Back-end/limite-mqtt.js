// Configuração retida separada dos comandos de acionamento.
function criarPublicadorLimite({ mqttClient, estado, topico }) {
    let fila = Promise.resolve();
    function publicarLimite() {
        const enviar = () => new Promise((resolve, reject) => {
            if (!mqttClient.connected) return reject(new Error('Broker MQTT desconectado'));
            const payload = JSON.stringify({ limitePotencia: estado.ultimoEstado.limitePico, unidade: 'W' });
            const prazo = setTimeout(() => reject(new Error('Sem confirmação do broker MQTT')), 8000);
            prazo.unref?.();
            mqttClient.publish(topico, payload, { qos: 1, retain: true }, erro => {
                clearTimeout(prazo);
                if (erro) reject(erro);
                else resolve();
            });
        });
        fila = fila.catch(() => {}).then(enviar);
        return fila;
    }
    return { publicarLimite };
}
module.exports = { criarPublicadorLimite };
