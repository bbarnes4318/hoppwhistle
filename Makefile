.PHONY: help up down seed logs clean restart build ps health

# Default target
.DEFAULT_GOAL := help

# Docker compose file paths
COMPOSE_DEV := infra/docker/docker-compose.dev.yml
COMPOSE_PROD := infra/docker/docker-compose.prod.yml
COMPOSE_FILES := -f $(COMPOSE_DEV)

# Detect if production mode
ifeq ($(ENV),prod)
	COMPOSE_FILES := -f $(COMPOSE_DEV) -f $(COMPOSE_PROD)
endif

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
RED := \033[0;31m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)Hopwhistle Docker Compose Commands$(NC)"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  $(YELLOW)make up$(NC)           Start all services"
	@echo "  $(YELLOW)make down$(NC)         Stop all services"
	@echo "  $(YELLOW)make seed$(NC)         Seed the database"
	@echo "  $(YELLOW)make logs$(NC)         View logs"
	@echo "  $(YELLOW)ENV=prod make up$(NC)  Start in production mode"

up: ## Start all services
	@echo "$(BLUE)Starting Hopwhistle services...$(NC)"
	@docker-compose $(COMPOSE_FILES) up -d
	@echo "$(GREEN)✓ Services started$(NC)"
	@echo ""
	@echo "$(YELLOW)Waiting for services to be ready...$(NC)"
	@sleep 5
	@make health
	@echo ""
	@echo "$(GREEN)✓ All services are running$(NC)"
	@echo ""
	@echo "Services available at:"
	@echo "  - Web UI:      http://localhost:3000"
	@echo "  - API:         http://localhost:3001"
	@echo "  - Grafana:     http://localhost:3000 (if not using web port)"
	@echo "  - Prometheus:  http://localhost:9090"
	@echo "  - MinIO:       http://localhost:9001"

down: ## Stop all services
	@echo "$(BLUE)Stopping Hopwhistle services...$(NC)"
	@docker-compose $(COMPOSE_FILES) down
	@echo "$(GREEN)✓ Services stopped$(NC)"

restart: ## Restart all services
	@echo "$(BLUE)Restarting Hopwhistle services...$(NC)"
	@docker-compose $(COMPOSE_FILES) restart
	@echo "$(GREEN)✓ Services restarted$(NC)"

build: ## Build all Docker images
	@echo "$(BLUE)Building Docker images...$(NC)"
	@docker-compose $(COMPOSE_FILES) build --no-cache
	@echo "$(GREEN)✓ Images built$(NC)"

ps: ## Show running services
	@docker-compose $(COMPOSE_FILES) ps

logs: ## View logs from all services
	@docker-compose $(COMPOSE_FILES) logs -f

logs-api: ## View API logs
	@docker-compose $(COMPOSE_FILES) logs -f api

logs-web: ## View Web logs
	@docker-compose $(COMPOSE_FILES) logs -f web

logs-worker: ## View Worker logs
	@docker-compose $(COMPOSE_FILES) logs -f worker

logs-freeswitch: ## View FreeSWITCH logs
	@docker-compose $(COMPOSE_FILES) logs -f freeswitch

seed: ## Seed the database
	@echo "$(BLUE)Seeding database...$(NC)"
	@docker-compose $(COMPOSE_FILES) exec api sh -c "cd /app && pnpm --filter @hopwhistle/api db:seed" || \
		echo "$(YELLOW)Note: Run 'pnpm db:seed' locally if seeding fails$(NC)"
	@echo "$(GREEN)✓ Database seeded$(NC)"

migrate: ## Run database migrations
	@echo "$(BLUE)Running database migrations...$(NC)"
	@docker-compose $(COMPOSE_FILES) exec api sh -c "cd /app && pnpm --filter @hopwhistle/api db:migrate" || \
		echo "$(YELLOW)Note: Run 'pnpm db:migrate' locally if migration fails$(NC)"
	@echo "$(GREEN)✓ Migrations completed$(NC)"

health: ## Check service health
	@echo "$(BLUE)Checking service health...$(NC)"
	@docker-compose $(COMPOSE_FILES) ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" | grep -E "(NAME|hopwhistle)" || true
	@echo ""

clean: ## Remove all containers, volumes, and networks (use clean-force to skip confirmation)
	@echo "$(RED)WARNING: This will remove all containers, volumes, and networks!$(NC)"
	@echo "Run 'make clean-force' to skip confirmation"
	@docker-compose $(COMPOSE_FILES) down -v --remove-orphans
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

clean-force: ## Force remove all containers, volumes, and networks (no confirmation)
	@docker-compose $(COMPOSE_FILES) down -v --remove-orphans
	@echo "$(GREEN)✓ Cleanup complete$(NC)"

clean-volumes: ## Remove all volumes (WARNING: deletes data)
	@echo "$(RED)WARNING: This will delete all volumes and data!$(NC)"
	@docker-compose $(COMPOSE_FILES) down -v
	@docker volume prune -f
	@echo "$(GREEN)✓ Volumes removed$(NC)"

shell-api: ## Open shell in API container
	@docker-compose $(COMPOSE_FILES) exec api sh

shell-postgres: ## Open shell in Postgres container
	@docker-compose $(COMPOSE_FILES) exec postgres psql -U callfabric -d callfabric

shell-redis: ## Open Redis CLI
	@docker-compose $(COMPOSE_FILES) exec redis redis-cli

test: ## Run tests
	@echo "$(BLUE)Running tests...$(NC)"
	@docker-compose $(COMPOSE_FILES) exec api sh -c "cd /app && pnpm test" || \
		echo "$(YELLOW)Note: Run 'pnpm test' locally if tests fail$(NC)"

test-sip: ## Run SIP tests
	@echo "$(BLUE)Running SIP tests...$(NC)"
	@cd tests/sip && node run-tests.js

# Production targets
prod-up: ## Start in production mode
	@ENV=prod $(MAKE) up

prod-down: ## Stop production services
	@ENV=prod $(MAKE) down

prod-logs: ## View production logs
	@ENV=prod $(MAKE) logs
