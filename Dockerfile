# 1) сборка одной страницы из исходников
FROM python:3.12-alpine AS build
WORKDIR /app
COPY build.py ./
COPY src ./src
RUN python build.py

# 2) статика через nginx
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
