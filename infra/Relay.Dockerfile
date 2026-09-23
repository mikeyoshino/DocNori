FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS build
WORKDIR /src
COPY Directory.Build.props global.json ./
COPY src/SabuySign.Relay/ src/SabuySign.Relay/
RUN dotnet publish src/SabuySign.Relay -c Release -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
USER $APP_UID
ENV ASPNETCORE_HTTP_PORTS=8080
ENTRYPOINT ["dotnet", "SabuySign.Relay.dll"]
