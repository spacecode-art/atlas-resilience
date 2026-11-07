# SC-04 disposable TLS boundary

`sc04-tls-proxy.yaml` runs the checked-in Node proxy in the local Tawira image.
The attended runner creates the CA and leaf certificates in a temporary
directory, creates the `sc04-tls-cert` and `sc04-tls-ca` Secrets, and removes
them during cleanup. The proxy forwards only to `http://tawira:3000`.

The certificate fault is a replacement of the leaf with an already-expired
certificate followed by `SIGHUP`. The proxy pod is not restarted and the CA,
hostname and upstream remain unchanged. A valid leaf is installed and reloaded
after the fault. No private key or certificate is checked in.
