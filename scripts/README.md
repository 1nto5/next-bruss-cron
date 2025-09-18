# MongoDB Replication Script

Simple script to replicate your production MongoDB database to localhost for development.

## Quick Start

1. **Run the script:**
   ```bash
   ./scripts/replicate-mongodb.sh
   ```

2. **Choose your options** from the interactive menu:
   - Option 1: Skip archive collections (recommended for faster sync)
   - Option 2: Replicate only specific collections
   - Option 3: Exclude specific collections
   - Options 4-5: Toggle verbose output and keep dump files
   - Press `c` to continue

3. **Confirm** the operation (type `y`)

## Common Usage

### Skip Large Archive Collections (Recommended)
```bash
./scripts/replicate-mongodb.sh
# Then press: 1, c, y
```

### Replicate Only Important Collections
```bash
./scripts/replicate-mongodb.sh
# Then press: 2
# Enter: users,deviations,production_tasks
# Then press: c, y
```

### Full Automatic Replication (Skip Archive)
```bash
./scripts/replicate-mongodb.sh --skip-archive --yes
```

### Quick Dev Sync (Exclude Heavy Collections)
```bash
./scripts/replicate-mongodb.sh --exclude scans_archive,oven_temperature_logs --yes
```

## What It Does

1. ✅ **Validates connections** to production and localhost
2. ✅ **Shows interactive menu** to choose what to replicate
3. ⚠️ **Drops your local database completely**
4. ✅ **Downloads production data** (compressed)
5. ✅ **Restores to localhost** as exact copy
6. ✅ **Cleans up** temporary files

## ⚠️ Important Notes

- **Your local database will be completely replaced**
- Use `--skip-archive` for faster syncing (excludes large archive collections)
- The script uses a read-only user for security
- Logs are saved in `scripts/logs/`
- Temporary dumps are saved in `backups/` (auto-cleaned)

## Command Line Options

| Option | Description |
|--------|-------------|
| `--yes` | Skip all confirmation prompts |
| `--skip-archive` | Automatically exclude collections with 'archive' in name |
| `--verbose` | Show detailed MongoDB output |
| `--keep-dump` | Keep dump files after restore |
| `--collections LIST` | Only replicate specific collections |
| `--exclude LIST` | Exclude specific collections |

## Examples

```bash
# Interactive mode (recommended for first time)
./scripts/replicate-mongodb.sh

# Quick sync without archives
./scripts/replicate-mongodb.sh --skip-archive --yes

# Only sync user-related data
./scripts/replicate-mongodb.sh --collections users,deviations --yes

# Exclude heavy collections
./scripts/replicate-mongodb.sh --exclude scans_archive,oven_temperature_logs,logs --yes

# Full sync with verbose output
./scripts/replicate-mongodb.sh --verbose --yes
```

## Troubleshooting

**Connection failed?**
- Check if MongoDB is running on localhost
- Verify production server is accessible

**Script hangs?**
- Large collections take time to download
- Use `--skip-archive` or `--exclude` for faster sync

**Want to see what's happening?**
- Use `--verbose` flag or option 4 in the menu