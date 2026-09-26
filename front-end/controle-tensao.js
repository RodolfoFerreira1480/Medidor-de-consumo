(() => {
    const campo = document.getElementById('input-tensao');
    const faixa = document.getElementById('range-tensao');
    const botao = document.getElementById('aplicar-tensao');
    const estado = document.getElementById('estado-tensao');
    const feedback = document.getElementById('feedback-tensao');
    let maxima = null;
    let disponivel = false;
    let enviando = false;
    let expiracao;
    const volts = valor => `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} V`;

    function atualizarCampos() {
        campo.disabled = faixa.disabled = botao.disabled = !disponivel || enviando;
        const valor = campo.value.trim() === '' ? NaN : Number(campo.value);
        campo.setCustomValidity(maxima !== null && Number.isFinite(valor) && (valor < 0 || valor > maxima)
            ? `Informe um valor entre 0 e ${volts(maxima)}.` : '');
    }

    window.atualizarControleTensao = dados => {
        clearTimeout(expiracao);
        maxima = typeof dados?.tensaoMaxima === 'number' && Number.isFinite(dados.tensaoMaxima)
            && dados.tensaoMaxima > 0 ? dados.tensaoMaxima : null;
        disponivel = Boolean(maxima && dados?.controleTensao?.disponivel);
        const card = document.getElementById('val-tensao-maxima');
        card.innerHTML = `${maxima === null ? '—' : maxima.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} <span class="metric-unit">V</span>`;
        document.getElementById('range-maximo').textContent = maxima === null ? '— V' : volts(maxima);
        campo.max = faixa.max = maxima ?? 0;
        estado.textContent = disponivel ? `Faixa disponível: 0 a ${volts(maxima)}.`
            : dados?.controleTensao?.motivo || 'Aguardando a tensão máxima informada pelo ESP32.';
        atualizarCampos();
        if (disponivel) {
            expiracao = setTimeout(() => {
                disponivel = false;
                estado.textContent = 'Sem atualização do medidor. Aguarde uma nova leitura.';
                atualizarCampos();
            }, 5000);
        }
    };

    campo.addEventListener('input', () => {
        if (campo.value !== '' && Number.isFinite(Number(campo.value))) faixa.value = campo.value;
        atualizarCampos();
    });
    faixa.addEventListener('input', () => { campo.value = faixa.value; atualizarCampos(); });
    document.getElementById('form-tensao').addEventListener('submit', async evento => {
        evento.preventDefault();
        if (!disponivel || enviando) return;
        atualizarCampos();
        if (!campo.reportValidity()) return;
        const valor = Number(campo.value);
        enviando = true;
        atualizarCampos();
        feedback.textContent = 'Enviando ajuste…';
        feedback.className = 'feedback';
        const abortar = new AbortController();
        const prazo = setTimeout(() => abortar.abort(), 10000);
        try {
            const base = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
            const resposta = await fetch(`${base}/api/tensao-saida`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tensaoSaida: valor }), signal: abortar.signal,
            });
            const resultado = await resposta.json();
            if (!resposta.ok) throw new Error(resultado.erro || 'Não foi possível enviar o ajuste.');
            document.getElementById('tensao-solicitada').textContent = volts(resultado.tensaoSolicitada);
            feedback.textContent = 'Comando enviado. Confira a tensão medida na saída.';
            feedback.className = 'feedback success';
        } catch (erro) {
            feedback.textContent = erro.name === 'AbortError'
                ? 'Envio sem confirmação. Confira a saída antes de tentar novamente.'
                : erro.message || 'Falha de conexão ao enviar o ajuste.';
            feedback.className = 'feedback error';
        } finally {
            clearTimeout(prazo);
            enviando = false;
            atualizarCampos();
        }
    });
})();
