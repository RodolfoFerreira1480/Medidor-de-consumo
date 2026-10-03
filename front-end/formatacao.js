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
