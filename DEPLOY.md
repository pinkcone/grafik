# Automatyczny deploy z GitHuba

Po jednorazowej konfiguracji serwera **każdy push na `main`** uruchamia deploy bez logowania na maszynę.

## Jak to działa

1. Wypychasz zmiany na GitHub (`git push`).
2. GitHub Actions łączy się z serwerem po SSH.
3. Na serwerze uruchamia się `scripts/deploy.sh`:
   - `git pull`
   - `npm ci` w `back/` i `front/`
   - `npm run build` frontendu
   - restart API przez **PM2**

## Jednorazowa konfiguracja serwera (VPS)

Zakładamy Ubuntu/Debian i domenę `jagrafiko.pl`. Ścieżka aplikacji: `/var/www/grafik`.

### 1. Pakiety

```bash
sudo apt update
sudo apt install -y git nginx mysql-server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 2. Klon repozytorium

```bash
sudo mkdir -p /var/www
sudo chown "$USER":"$USER" /var/www
git clone https://github.com/pinkcone/grafik.git /var/www/grafik
cd /var/www/grafik
```

### 3. Konfiguracja backendu

```bash
cp back/.env.example back/.env
nano back/.env   # uzupełnij DB_*, JWT_SECRET, ALLOWED_ORIGINS
```

### 4. Pierwszy deploy ręczny (tylko raz)

```bash
chmod +x scripts/deploy.sh
bash scripts/deploy.sh
pm2 startup   # wykonaj komendę, którą PM2 wypisze (sudo ...)
```

### 5. Nginx

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/grafik
# popraw server_name i ścieżkę root jeśli trzeba
sudo ln -s /etc/nginx/sites-available/grafik /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Opcjonalnie HTTPS: `sudo certbot --nginx -d jagrafiko.pl`

### 6. Klucz SSH do GitHub Actions

Na **swoim komputerze** (nie na serwerze produkcyjnym):

```bash
ssh-keygen -t ed25519 -C "github-deploy-grafik" -f ~/.ssh/grafik_deploy -N ""
```

- Klucz **publiczny** (`grafik_deploy.pub`) → na serwerze w `~/.ssh/authorized_keys`
- Klucz **prywatny** (`grafik_deploy`) → sekret w GitHubie (poniżej)

Na serwerze upewnij się, że użytkownik deploy może:

```bash
cd /var/www/grafik && git pull   # bez hasła, repo już sklonowane
pm2 list
```

### 7. Repozytorium prywatne (opcjonalnie)

Jeśli repo jest prywatne, na serwerze skonfiguruj klucz deploy tylko do odczytu:

```bash
ssh-keygen -t ed25519 -C "grafik-server" -f ~/.ssh/grafik_github -N ""
cat ~/.ssh/grafik_github.pub   # dodaj jako Deploy key w GitHub → repo → Settings → Deploy keys
```

Następnie zmień remote na SSH:

```bash
cd /var/www/grafik
git remote set-url origin git@github.com:pinkcone/grafik.git
```

## Sekrety w GitHubie

Repozytarium → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

| Sekret | Przykład | Opis |
|--------|----------|------|
| `SSH_HOST` | `123.45.67.89` lub `jagrafiko.pl` | Adres serwera |
| `SSH_USER` | `ubuntu` | Użytkownik SSH |
| `SSH_PRIVATE_KEY` | cała zawartość pliku `grafik_deploy` | Klucz prywatny |
| `SSH_PORT` | `22` | Opcjonalnie, jeśli inny port |
| `APP_DIR` | `/var/www/grafik` | Katalog z repozytorium |

## Test

```bash
git push origin main
```

W GitHubie: zakładka **Actions** — powinien pojawić się zielony workflow „Deploy to production”.

## Ręczny deploy (awaryjnie)

Na serwerze:

```bash
cd /var/www/grafik && bash scripts/deploy.sh
```

## Uwagi

- Baza MySQL **nie jest** nadpisywana przy deployu — zmienia się tylko kod.
- Plik `back/.env` zostaje na serwerze i nie trafia do gita (jest w `.gitignore`).
- Frontend w produkcji korzysta z `/api/...` przez nginx — nie trzeba `REACT_APP_BACKEND_URL`, jeśli nginx jest skonfigurowany jak w przykładzie.
