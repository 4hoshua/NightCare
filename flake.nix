{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in
    {

      shellHook = ''
        # Evita que um API_TOKEN exportado antes sobreponha o .env do compose
        unset API_TOKEN MQTT_BACKEND_PASSWORD

        # Uso: nc status | nc "events?limit=20"
        nc() {
          curl -fsS \
            -H "Authorization: Bearer $(grep '^API_TOKEN=' .env | cut -d= -f2-)" \
            "http://127.0.0.1:3000/api/$1"
        }
      '';

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.docker
          pkgs.docker-compose
          pkgs.openssl
          pkgs.bash
          pkgs.bore-cli
          pkgs.platformio
        ];
      };
    };
}
