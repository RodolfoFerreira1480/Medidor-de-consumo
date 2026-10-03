let limitePicoUI = 1000;
function mostrarMensagemLimite(texto, sucesso = true) {
    const mensagem = document.getElementById('msg-limite');
    mensagem.textContent = texto;
    mensagem.className = `limit-message is-visible ${sucesso ? '' : 'is-error'}`;

    setTimeout(() => {
        mensagem.classList.remove('is-visible');
    }, 2500);
}

async function carregarLimite() {
    try {
        const resposta = await fetch(apiUrl('/api/config/limite'));
        if (!resposta.ok) throw new Error('Falha ao buscar limite');

        const dados = await resposta.json();
        limitePicoUI = numeroFinito(dados.limite, limitePicoUI);
        document.getElementById('input-limite').value = limitePicoUI;
    } catch (e) {
        console.error('Erro ao carregar limite de pico:', e);
    }
}

async function carregarPicos() {
    try {
        const resposta = await fetch(apiUrl('/api/picos'));
        if (!resposta.ok) throw new Error('Falha ao buscar picos');

        const dados = await resposta.json();
        const picos = Array.isArray(dados.picos) ? dados.picos : [];

        limitePicoUI = numeroFinito(dados.limite, limitePicoUI);
        document.getElementById('input-limite').value = limitePicoUI;

        const titulo = document.getElementById('titulo-picos');
        if (titulo) {
            titulo.textContent = `Picos acima de ${formatarNumero(limitePicoUI, 0)} W`;
        }

        const lista = document.getElementById('listaPicos');
        lista.innerHTML = '';

        if (picos.length === 0) {
            lista.innerHTML = '<li class="empty-state">Nenhum pico registrado hoje.</li>';
            return;
        }

        picos.forEach((pico) => {
            const item = document.createElement('li');
            item.className = 'peak-item';
            item.textContent = `Pico de ${formatarNumero(pico.potencia, 1)}W registrado às ${pico.horario}`;
            lista.appendChild(item);
        });
    } catch (e) {
        console.error('Erro ao carregar os picos:', e);
    }
}

async function salvarNovoLimite() {
    const input = document.getElementById('input-limite');
    const novoLimite = Number(input.value);

    if (!Number.isFinite(novoLimite) || novoLimite <= 0) {
        mostrarMensagemLimite('Informe um limite maior que zero.', false);
        return;
    }

    try {
        const resposta = await fetch(apiUrl('/api/config/limite'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ novoLimite }),
        });
        const resultado = await resposta.json();

        if (!resposta.ok) {
            throw new Error(resultado.erro || 'Falha ao salvar limite');
        }

        limitePicoUI = numeroFinito(resultado.limite, novoLimite);
        input.value = limitePicoUI;
        mostrarMensagemLimite('Limite salvo com sucesso.');
        await carregarPicos();
        await atualizarDados();
    } catch (e) {
        mostrarMensagemLimite(e.message || 'Erro ao salvar limite.', false);
    }
}
