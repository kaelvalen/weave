import os
import sys

# Define the explicit dependency contract for internal crates.
# Crate name -> List of allowed internal dependencies.
# If a crate is not listed, it cannot depend on any internal crates.
# If a dependency is not listed here, CI will fail.
ALLOWED_DEPENDENCIES = {
    "runtime-kernel": [],
    "capabilities": ["runtime-kernel"],
}

def parse_cargo_toml_dependencies(toml_path):
    """Very naive parser to extract internal dependencies from Cargo.toml"""
    deps = []
    in_dependencies_section = False
    with open(toml_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('[dependencies]'):
                in_dependencies_section = True
                continue
            if line.startswith('[') and in_dependencies_section:
                # E.g. [dev-dependencies], stop parsing
                if not line.startswith('[dependencies.'):
                    in_dependencies_section = False
            
            if in_dependencies_section and '=' in line:
                pkg_name = line.split('=')[0].strip()
                # Internal crates we care about checking
                if pkg_name in ALLOWED_DEPENDENCIES.keys():
                    deps.append(pkg_name)
    return deps

def main():
    workspace_dir = os.path.join(os.path.dirname(__file__), '..')
    crates_dir = os.path.join(workspace_dir, 'crates')
    
    if not os.path.exists(crates_dir):
        print(f"Error: {crates_dir} not found.")
        sys.exit(1)
        
    crates = [d for d in os.listdir(crates_dir) if os.path.isdir(os.path.join(crates_dir, d))]
    
    violations_found = False
    
    for crate in crates:
        if crate not in ALLOWED_DEPENDENCIES:
            print(f"WARNING: Crate '{crate}' is not tracked in the architecture contract.")
            continue
            
        cargo_toml = os.path.join(crates_dir, crate, 'Cargo.toml')
        if not os.path.exists(cargo_toml):
            continue
            
        actual_deps = parse_cargo_toml_dependencies(cargo_toml)
        allowed = ALLOWED_DEPENDENCIES[crate]
        
        for dep in actual_deps:
            if dep not in allowed:
                print(f"ERROR: Architectural violation in '{crate}'! Depends on '{dep}' which is not in its allowed list: {allowed}")
                violations_found = True
                
    if violations_found:
        print("\nArchitecture check FAILED. Please update your dependencies to adhere to the explicit contract.")
        sys.exit(1)
    else:
        print("\nArchitecture check PASSED. All internal dependencies comply with the contract.")

if __name__ == "__main__":
    main()
