function lerConfiguracao(env) {
    const LIMITE_PICO_PADRAO = Number(env.LIMITE_PICO_PADRAO) || 1000;
    const VALIDADE_LEITURA_MS = 15000;

    const MQTT_BROKER = env.MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';
    const TOPIC_DADOS = env.MQTT_TOPIC_DADOS || 'smart-meter/medidor/dados';
    const TOPIC_COMANDO = env.MQTT_TOPIC_COMANDO || 'smart-meter/medidor/comando';
    const TOPIC_ALERTA = env.MQTT_TOPIC_ALERTA || 'smart-meter/medidor/alerta';

    const TOPIC_LIMITE = env.MQTT_TOPIC_LIMITE || 'smart-meter/medidor/config/limite';
    const PORT = env.PORT || 3000;

    return {
        LIMITE_PICO_PADRAO,
        VALIDADE_LEITURA_MS,
        MQTT_BROKER,
        TOPIC_DADOS,
        TOPIC_COMANDO,
        TOPIC_ALERTA,
        TOPIC_LIMITE,
        PORT,
    };
}

module.exports = { lerConfiguracao };
