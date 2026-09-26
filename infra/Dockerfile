FROM node:24-bookworm-slim AS client
WORKDIR /source
COPY package*.json ./
RUN npm ci
COPY scripts/ scripts/
COPY src/SabuySign.Web/Client/ src/SabuySign.Web/Client/
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS build
WORKDIR /source
COPY global.json Directory.Build.props ./
COPY src/SabuySign.Web/ src/SabuySign.Web/
COPY src/SabuySign.Host/ src/SabuySign.Host/
COPY src/SabuySign.Media/ src/SabuySign.Media/
COPY src/SabuySign.Media.Worker/ src/SabuySign.Media.Worker/
COPY --from=client /source/src/SabuySign.Web/wwwroot/js/ src/SabuySign.Web/wwwroot/js/
RUN dotnet publish src/SabuySign.Host -c Release -o /app
RUN dotnet publish src/SabuySign.Media.Worker -c Release -o /worker

FROM ubuntu:24.04 AS word-sandbox
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev libseccomp-dev linux-libc-dev
COPY infra/word-pdf/sandbox.c /sandbox.c
RUN gcc -O2 -Wall -Wextra -Werror /sandbox.c -lseccomp -o /word-sandbox

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libreoffice-writer python3-uno libseccomp2 fonts-thai-tlwg fonts-noto-core fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea && rm -rf /var/lib/apt/lists/* && mkdir -p /media /templates /keys && chown $APP_UID:$APP_UID /media /templates /keys && chmod 700 /templates /keys
COPY --from=word-sandbox /word-sandbox /usr/local/bin/word-sandbox
COPY infra/word-pdf/word_pdf.py /usr/local/lib/docnori/word_pdf.py
COPY src/SabuySign.Web/wwwroot/fonts/*.ttf /usr/local/share/fonts/docnori/
RUN fc-cache -f && mkdir -p /app/tmp && chown $APP_UID:$APP_UID /app/tmp && chmod 555 /tmp /var/tmp
ENV TMPDIR=/app/tmp
WORKDIR /app
COPY --from=build /app .
COPY --from=build /worker /app/worker
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
ENTRYPOINT ["dotnet", "SabuySign.Host.dll"]
