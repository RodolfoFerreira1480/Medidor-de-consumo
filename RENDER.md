# Banco de dados no Render

No Supabase, abra Connect e copie a conexao PostgreSQL de Session pooler.
No Render, abra Environment e cadastre DATABASE_URL com essa conexao,
substituindo o marcador de senha pela senha do banco. Caracteres especiais
na senha devem ser codificados para URL. Nao use a URL da API nem a chave anon.

DATABASE_URL tem prioridade sobre DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e
DB_DATABASE. Como alternativa, preencha essas cinco variaveis com os dados
da mesma conexao fornecida pelo Supabase.

No Render, TLS e habilitado por padrao com validacao de certificado.
Se a conexao exigir o certificado CA do Supabase, cadastre seu conteudo PEM
em DB_SSL_CA. Nao desative a validacao do certificado. Opcoes SSL presentes
na propria DATABASE_URL sao interpretadas pelo driver PostgreSQL; evite
mistura-las com DB_SSL_CA.

Salve as variaveis e publique a versao atual. Confira nos logs:
"Banco de dados pronto para uso." e "Dados salvos no PostgreSQL com sucesso."
O envio do codigo ao GitHub nao cadastra essas variaveis no Render.
Nunca envie senhas, DATABASE_URL ou o arquivo .env ao GitHub.
