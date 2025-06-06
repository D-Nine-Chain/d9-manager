# Get version from git tag or use dev version
VERSION := $(shell git describe --tags --abbrev=0 2>/dev/null || echo "dev")
COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE := $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

# Build flags
BUILD_FLAGS := --allow-all --output ./dist/d9-manager

.PHONY: version
version:
	@echo "Version: $(VERSION)"
	@echo "Commit: $(COMMIT)"
	@echo "Build Date: $(BUILD_DATE)"

.PHONY: build
build:
	@echo "Building d9-manager $(VERSION)..."
	@echo 'export const VERSION = "$(VERSION)";' > src/version.ts
	@echo 'export const COMMIT = "$(COMMIT)";' >> src/version.ts
	@echo 'export const BUILD_DATE = "$(BUILD_DATE)";' >> src/version.ts
	deno compile $(BUILD_FLAGS) src/main.ts

.PHONY: clean
clean:
	rm -rf dist/
	rm -f src/version.ts

.PHONY: tag
tag:
	@read -p "Enter version (e.g., v1.0.0): " version; \
	git tag -a $$version -m "Release $$version"; \
	echo "Tagged as $$version. Push with: git push origin $$version"

.PHONY: release
release: clean build
	@echo "Built release $(VERSION)"

.PHONY: build-linux
build-linux:
	@echo "Building d9-manager $(VERSION) for Linux arm64..."
	@echo 'export const VERSION = "$(VERSION)";' > src/version.ts
	@echo 'export const COMMIT = "$(COMMIT)";' >> src/version.ts
	@echo 'export const BUILD_DATE = "$(BUILD_DATE)";' >> src/version.ts
	deno compile --target aarch64-unknown-linux-gnu $(BUILD_FLAGS) src/main.ts
	mv ./dist/d9-manager ./dist/d9-manager-linux-arm64

.PHONY: test-docker
test-docker:
	./scripts/test-docker.sh

.PHONY: test-docker-interactive
test-docker-interactive:
	./scripts/test-docker-interactive.sh

.PHONY: test-docker-auto
test-docker-auto:
	./scripts/test-docker-auto.sh
