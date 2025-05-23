#!/bin/bash

# Build the test image (this will also build d9-manager inside the container)
echo "Building Docker test image and compiling d9-manager..."
docker build -t d9-test -f Dockerfile.test .

# Run the container and test d9-manager
echo "Running test container..."
docker run -it --rm d9-test /bin/bash -c "d9-manager setup"