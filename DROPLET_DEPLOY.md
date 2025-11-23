# Droplet Deployment Guide

Since you are using a **DigitalOcean Droplet** (VPS) with a **Managed PostgreSQL Database**, the "App Platform" instructions do not apply.

Follow these steps to deploy your changes.

## Prerequisites

Ensure you have created the shared network on your Droplet (run once):

```bash
docker network create data_net
```

Ensure `make` is installed:

```bash
apt update && apt install -y make
```

## Deployment Steps

1.  **SSH into your Droplet**:

    ```bash
    ssh root@your-droplet-ip
    ```

2.  **Navigate to your project**:

    ```bash
    cd /path/to/hopwhistle
    ```

3.  **Pull the latest changes**:

    ```bash
    git pull origin master
    ```

4.  **Update Environment Variables (if needed)**:
    - Edit your `.env` file: `nano .env`
    - Ensure `DATABASE_URL` points to your Managed PostgreSQL instance.
    - Ensure `REDIS_URL` points to your Managed Redis instance (if applicable).

5.  **Rebuild and Restart**:
    Run the following commands to rebuild the images and restart the containers in production mode:

    ```bash
    # Build the images
    make build

    # Start services in production mode
    make prod-up
    ```

    _Note: `make prod-up` uses `docker-compose.prod.yml` which expects the `data_net` network to exist._

## Troubleshooting

### Network Issues

If your API cannot talk to other services, check that all services are on the same network. The production configuration uses `data_net`.

### Database Connection

If the app fails to connect to the database:

- Check the `DATABASE_URL` in `.env`.
- Ensure the Managed Database allows connections from your Droplet's IP (Trusted Sources).

### Logs

To check logs:

```bash
make prod-logs
```
