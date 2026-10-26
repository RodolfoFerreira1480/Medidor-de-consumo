function tensaoValida(valor) {
    if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return null;
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 0 ? numero : null;
}

function numeroFinito(valor, padrao = 0) {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero : padrao;
}

function normalizarLeitura(dadosRecebidos) {
    const tensao = numeroFinito(dadosRecebidos.tensao);
    const saidaRecebida = dadosRecebidos.tensaoSaida ?? dadosRecebidos.tensao_saida;
    const tensaoSaida = tensaoValida(saidaRecebida);
    const maxima = tensaoValida(dadosRecebidos.tensaoMaxima ?? dadosRecebidos.tensao_maxima);
    const tensaoMaxima = maxima > 0 ? maxima : null;
    const corrente = numeroFinito(dadosRecebidos.corrente);
    const potenciaInformada =
        dadosRecebidos.potencia == null ? NaN : Number(dadosRecebidos.potencia);
    const potencia = Number.isFinite(potenciaInformada)
        ? potenciaInformada
        : (tensaoSaida ?? tensao) * corrente;
    const consumoKWh = numeroFinito(
        dadosRecebidos.consumoKWh ??
            dadosRecebidos.consumoKwh ??
            dadosRecebidos.consumokwh ??
            dadosRecebidos.consumo_kwh,
    );

    return { tensao, tensaoSaida, tensaoMaxima, corrente, potencia, consumoKWh };
}

module.exports = { tensaoValida, numeroFinito, normalizarLeitura };
