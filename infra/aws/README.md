# Docker na AWS

A primeira implantação deve usar uma única instância EC2 ou Lightsail com um volume EBS. As duas
imagens são publicadas no Amazon ECR e executadas pelo Docker Compose.

```text
GitHub Actions -> Amazon ECR -> EC2/Lightsail
                                   |-- web
                                   `-- api -> EBS -> SQLite
```

## Por que não ECS/Fargate neste estágio

O SQLite precisa de armazenamento persistente com semântica de disco local. O armazenamento da
task Fargate é efêmero, EFS é um filesystem de rede inadequado para SQLite em WAL, e volumes EBS
gerenciados por um ECS Service são removidos junto com a task. Quando o projeto migrar para um
banco externo, as mesmas imagens poderão ser executadas no ECS sem essa restrição.

## Amazon ECR

Crie dois repositórios privados:

- `codekeat-api`
- `codekeat-web`

Aplique `infra/aws/ecr/lifecycle-policy.json` aos dois repositórios. Configure estas variables no
GitHub Actions:

- `AWS_REGION`
- `AWS_ROLE_ARN`: role assumida via GitHub OIDC, com permissão de push nos dois repositórios.
- `ECR_API_REPOSITORY`
- `ECR_WEB_REPOSITORY`
- `NEXT_PUBLIC_API_URL`: URL pública da API incorporada ao build do frontend.

Execute manualmente o workflow `Publish Docker images`. Cada imagem recebe as tags `latest` e
`sha-<commit>`.

## Host EC2

Use uma instância `x86_64`, associe uma instance role com permissão de pull no ECR e monte um volume
EBS formatado em ext4 em um caminho persistente, por exemplo `/mnt/codekeat`. Não use EFS para o
arquivo SQLite. O diretório precisa pertencer ao UID/GID `1000`, utilizado pelo usuário não-root das
imagens:

```sh
sudo install -d -o 1000 -g 1000 /mnt/codekeat
```

No host, mantenha em `/opt/codekeat`:

- `compose.yaml`
- `.env`, criado a partir de `.env.example`
- `apps/api/.env`, contendo os secrets do GitHub App e Gemini

Configure pelo menos:

```dotenv
API_IMAGE=ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/codekeat-api:sha-COMMIT
WEB_IMAGE=ACCOUNT_ID.dkr.ecr.REGION.amazonaws.com/codekeat-web:sha-COMMIT
CODEKEAT_DATA_DIR=/mnt/codekeat
BIND_ADDRESS=127.0.0.1
```

O bind em loopback pressupõe um reverse proxy ou agente de túnel no host. Para conectar diretamente
um Application Load Balancer às portas da instância, use `BIND_ADDRESS=0.0.0.0` e restrinja o
Security Group para aceitar tráfego apenas do Security Group do load balancer.

Para iniciar:

```sh
docker compose pull
docker compose up --detach --no-build
```

O arquivo `infra/aws/ec2/codekeat.service` pode ser instalado como um serviço systemd para restaurar
os containers após reinicializações. O host precisa estar autenticado no ECR, preferencialmente com
o Amazon ECR Docker Credential Helper e uma instance role.

## Restrições operacionais

- Mantenha exatamente uma réplica da API enquanto ela usar SQLite.
- Faça snapshots frequentes do EBS e backups consistentes do banco.
- Não coloque secrets em imagens ou no `.env` raiz usado pelo Compose.
- O endpoint público deve usar HTTPS por meio de ALB, Caddy, Traefik ou outro reverse proxy.
- Quando alta disponibilidade ou múltiplas réplicas forem necessárias, migre o banco para um serviço
  externo antes de mover a API para ECS/Fargate.
