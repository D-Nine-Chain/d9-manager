#!/bin/bash

# Development testing script - copy changes into running container and rebuild

# Check if container is already running
if docker ps | grep -q d9-test-dev; then
    echo "Using existing container d9-test-dev"
else
    echo "Starting new development container..."
    docker run -d --name d9-test-dev d9-test tail -f /dev/null
fi

echo "Copying updated source files..."
docker cp src/. d9-test-dev:/home/ubuntu/d9-manager/src/

echo "Rebuilding d9-manager inside container..."
docker exec d9-test-dev bash -c "cd /home/ubuntu/d9-manager && deno compile --allow-all --no-check --output ./dist/d9-manager src/main.ts && chmod +x ./dist/d9-manager"

if [ $? -ne 0 ]; then
    echo "Build failed! Check for compilation errors."
    exit 1
fi

echo "Running d9-manager with latest changes..."
# Use -t flag only if running in a terminal
if [ -t 0 ]; then
    docker exec -it d9-test-dev bash -c "cd /home/ubuntu/d9-manager && ./dist/d9-manager $*"
else
    docker exec -i d9-test-dev bash -c "cd /home/ubuntu/d9-manager && ./dist/d9-manager $*"
fi

echo ""
echo "Container is still running. You can:"
echo "  - Run more tests: ./scripts/test-docker-dev.sh [command]"
echo "  - Get a shell: docker exec -it d9-test-dev bash"
echo "  - Stop container: docker stop d9-test-dev && docker rm d9-test-dev"