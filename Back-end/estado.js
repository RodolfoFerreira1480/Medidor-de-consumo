function criarEstado(LIMITE_PICO_PADRAO) {
    let ultimoEstado = {
        tensao: 0,
        tensaoSaida: null,
        tensaoMaxima: null,
        corrente: 0,
        potencia: 0,
        consumoKWh: 0,
        limitePico: LIMITE_PICO_PADRAO,
        statusAlerta: false,
        alerta: null,
        timestampLeitura: null,
        timestamp: null,
    };

    let desarmePorPicoAtivo = false;
    let leituraAoVivo = false;
    let ajusteEmAndamento = false;

    return { ultimoEstado, desarmePorPicoAtivo, leituraAoVivo, ajusteEmAndamento };
}

module.exports = { criarEstado };
