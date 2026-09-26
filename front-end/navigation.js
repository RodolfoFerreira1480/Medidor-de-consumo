const linksSecoes = [...document.querySelectorAll('.nav-link')];
const secoesPainel = [...document.querySelectorAll('.page-section')];
function destacarSecao(id) {
    linksSecoes.forEach(link => {
        const ativo = link.hash === `#${id}`;
        link.classList.toggle('is-active', ativo);
        if (ativo) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
    });
}
function atualizarSecaoVisivel() {
    const referencia = window.innerHeight * 0.3;
    let atual = secoesPainel[0];
    for (const secao of secoesPainel) {
        if (secao.getBoundingClientRect().top <= referencia) atual = secao;
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        atual = secoesPainel[secoesPainel.length - 1];
    }
    if (atual) destacarSecao(atual.id);
}
let atualizacaoPendente = false;
window.addEventListener('scroll', () => {
    if (atualizacaoPendente) return;
    atualizacaoPendente = true;
    requestAnimationFrame(() => {
        atualizarSecaoVisivel();
        atualizacaoPendente = false;
    });
}, { passive: true });
window.addEventListener('resize', atualizarSecaoVisivel);
window.addEventListener('load', atualizarSecaoVisivel);
atualizarSecaoVisivel();
