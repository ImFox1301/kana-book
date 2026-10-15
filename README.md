# Кана-тетрадь

Тренажёр хираганы, катаканы и слов: рисуете знак пальцем, сайт распознаёт его без ИИ (сравнение облаков точек + карты направлений штрихов, эталоны из KanjiVG).

## Как устроен деплой

```
git push → GitHub Actions (тест распознавателя + сборка образа) → ghcr.io → Watchtower на сервере сам подтягивает новый образ
```

Серверу не нужен входящий доступ для деплоя, а репозиторию — пароль от сервера.

## Сервер

Caddy занимает порты 80 и 443 и сам выпускает сертификат Let's Encrypt для домена сайта. Другие сервисы на сервере не затрагиваются, если они не слушают 80 и 443.

Первый запуск (один раз):

```bash
mkdir -p ~/kana-tetrad && cd ~/kana-tetrad
# положить сюда docker-compose.yml и Caddyfile из репозитория
echo "SITE_DOMAIN=kana.example.com" > .env
docker compose up -d
docker compose logs -f caddy      # ждать строку "certificate obtained successfully"
```

DNS: A-запись домена сайта → IP сервера.

Если на сервере есть другой сервис, который продлевает свой сертификат через acme.sh в режиме standalone (ему нужен порт 80), пропишите ему хуки, чтобы на время продления Caddy останавливался:

```bash
sudo ~/.acme.sh/acme.sh --renew -d <его домен> --force \
  --pre-hook "docker stop kana-caddy" --post-hook "docker start kana-caddy"
```

## Локальная разработка

```bash
python3 build.py              # → dist/index.html, открыть в браузере
node tools/test.js            # синтетический тест точности распознавания
docker build -t kana-tetrad . && docker run --rm -p 8080:80 kana-tetrad
```

## Структура

- `src/app.html`, `src/app.js` — интерфейс квиза и словаря
- `src/recognizer.js` — распознаватель рукописной каны
- `src/kvg.json` — штрихи каны из [KanjiVG](https://kanjivg.tagaini.net) (CC BY-SA 3.0, © Ulrich Apel)
- `src/kana.js` — таблицы каны, транскрипции Хэпбёрна и Поливанова, проверка ответов
- `src/words.js` — стартовый словарь
- `tools/kvg_parse.py` — пересборка `kvg.json` из SVG-файлов KanjiVG
