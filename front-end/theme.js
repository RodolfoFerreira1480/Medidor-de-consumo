// Executado antes do CSS para evitar um clarão ao restaurar a preferência.
(() => {
    const chave = 'energia-tema';
    const sistema = window.matchMedia('(prefers-color-scheme: dark)');
    let preferencia;
    try { preferencia = localStorage.getItem(chave); } catch { /* Armazenamento indisponível. */ }
    if (!['light', 'dark'].includes(preferencia)) preferencia = null;

    function aplicar(tema) {
        document.documentElement.dataset.theme = tema;
        const botao = document.getElementById('theme-toggle');
        const label = document.getElementById('theme-label');
        if (botao) botao.setAttribute('aria-pressed', String(tema === 'dark'));
        if (label) label.textContent = tema === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro';
        window.dispatchEvent(new Event('themechange'));
    }

    window.alternarTema = () => {
        preferencia = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(chave, preferencia); } catch { /* O botão continua funcionando. */ }
        aplicar(preferencia);
    };
    aplicar(preferencia || (sistema.matches ? 'dark' : 'light'));
    document.addEventListener('DOMContentLoaded', () => aplicar(document.documentElement.dataset.theme));
    sistema.addEventListener('change', evento => {
        if (!preferencia) aplicar(evento.matches ? 'dark' : 'light');
    });
})();
