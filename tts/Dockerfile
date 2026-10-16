# Сервис озвучки слов: VOICEVOX CORE + два голоса (VOICEVOX:青山龍星, VOICEVOX:波音リツ). Только linux/amd64.
FROM python:3.12-slim-bookworm AS fetch
ARG VV=0.16.4
ADD https://github.com/VOICEVOX/voicevox_core/releases/download/${VV}/voicevox_core-${VV}-cp310-abi3-manylinux_2_34_x86_64.whl /dl/
ADD https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-linux-x64-1.17.3.tgz /dl/
ADD https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz /dl/
ADD https://github.com/VOICEVOX/voicevox_vvm/releases/download/${VV}/15.vvm /opt/voicevox/vvms/15.vvm
ADD https://github.com/VOICEVOX/voicevox_vvm/releases/download/${VV}/3.vvm /opt/voicevox/vvms/3.vvm
RUN cd /opt/voicevox && tar xzf /dl/voicevox_onnxruntime-linux-x64-1.17.3.tgz && tar xzf /dl/open_jtalk_dic_utf_8-1.11.tar.gz \
 && chmod -R a+rX /opt/voicevox /dl   # файлы из ADD по URL приходят с правами 600

FROM python:3.12-slim-bookworm
COPY --from=fetch /dl/*.whl /tmp/
RUN pip install --no-cache-dir /tmp/voicevox_core-*.whl numpy soundfile lameenc && rm /tmp/*.whl \
 && useradd -r -u 10001 kana && mkdir /cache && chown kana /cache
COPY --from=fetch /opt/voicevox /opt/voicevox
COPY app.py /app/app.py
USER kana
ENV VOICEVOX_DIR=/opt/voicevox CACHE_DIR=/cache PORT=8081 PYTHONUNBUFFERED=1
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8081/api/tts/health')"
CMD ["python", "/app/app.py"]
