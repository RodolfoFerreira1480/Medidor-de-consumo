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
