#!/bin/bash

# Build the test image (this will also build d9-manager inside the container)
echo "Building Docker test image and compiling d9-manager..."
docker build -t d9-test -f Dockerfile.test .

# Run the container interactively
echo "Starting interactive test container..."
echo "d9-manager is available in PATH. Try: d9-manager --help"
docker run -it --rm d9-test