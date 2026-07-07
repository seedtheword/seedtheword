def gather_repository_context(root_dir):
    """Recursively reads all text-based code files in the project folder, skipping media and secrets."""
    repo_context = []
    
    # Extensions we want the Architect to read
    ALLOWED_EXTENSIONS = {'.html', '.css', '.js', '.py', '.md', '.json'}
    # Folders we want to completely ignore
    IGNORE_FOLDERS = {'.git', '__pycache__', 'node_modules', 'assets'}

    for root, dirs, files in os.walk(root_dir):
        # Filter out directories we don't want to crawl
        dirs[:] = [d for d in dirs if d not in IGNORE_FOLDERS]
        
        for file in files:
            # Skip hidden files like .env or .gitignore
            if file.startswith('.'):
                continue
                
            file_path = os.path.join(root, file)
            
            # Fix: Unpack the tuple first, then safely convert the extension string to lowercase
            _, ext = os.path.splitext(file)
            ext = ext.lower()
            
            if ext in ALLOWED_EXTENSIONS:
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                        # Create a clear structural boundary for each file
                        relative_path = os.path.relpath(file_path, root_dir)
                        repo_context.append(f"=== FILE: {relative_path} ===\n{content}\n")
                except Exception as e:
                    # Soft skip if a binary or locked file slips through
                    continue
                    
    return "\n".join(repo_context)
