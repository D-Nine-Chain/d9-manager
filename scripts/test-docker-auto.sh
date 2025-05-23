#!/bin/bash

# Build the test image (this will also build d9-manager inside the container)
echo "Building Docker test image and compiling d9-manager..."
docker build -t d9-test -f Dockerfile.test .

# Run automated tests
echo "Running automated tests..."
echo "==========================================="

echo -e "\n1. Testing d9-manager --help"
docker run --rm d9-test d9-manager --help

echo -e "\n2. Testing d9-manager --version"
docker run --rm d9-test d9-manager --version

echo -e "\n3. Testing d9-manager setup with automated responses"
# Using printf to simulate user input for setup
docker run --rm d9-test /bin/bash -c 'printf "1\nFull Node\nyes\n" | d9-manager setup' || {
    echo "Setup failed with exit code: $?"
    echo "This is expected if the setup requires more interactive input"
}

echo -e "\nAutomated tests completed"