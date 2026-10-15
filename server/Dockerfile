# Jar собирается заранее (gradle bootJar) — так образ для arm64 не компилирует Kotlin под эмуляцией
FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S kana && adduser -S kana -G kana
USER kana
WORKDIR /app
COPY build/libs/kana-api.jar ./kana-api.jar
ENV JAVA_TOOL_OPTIONS="-XX:+UseSerialGC -Xss512k -XX:MaxRAMPercentage=70 -XX:TieredStopAtLevel=1"
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["java", "-jar", "kana-api.jar"]
