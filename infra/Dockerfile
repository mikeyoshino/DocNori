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

FROM mcr.microsoft.com/dotnet/aspnet:10.0
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/* && mkdir -p /media && chown $APP_UID:$APP_UID /media
WORKDIR /app
COPY --from=build /app .
COPY --from=build /worker /app/worker
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
ENTRYPOINT ["dotnet", "SabuySign.Host.dll"]
