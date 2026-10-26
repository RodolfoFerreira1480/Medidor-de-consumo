async function enviarComando(acao) {
    const feedback = document.getElementById('feedback-comando');
    feedback.textContent = `Enviando comando '${acao}'...`;
    feedback.className = 'feedback';

    try {
        const resposta = await fetch(apiUrl('/api/comando'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ acao }),
        });
        const resultado = await resposta.json();

        if (resposta.ok) {
            feedback.textContent = `Sucesso: ${resultado.mensagem}`;
            feedback.className = 'feedback success';
        } else {
            feedback.textContent = `Erro: ${resultado.erro}`;
            feedback.className = 'feedback error';
        }
    } catch (e) {
        feedback.textContent = 'Erro de conexao ao tentar enviar o comando.';
        feedback.className = 'feedback error';
    }
}
