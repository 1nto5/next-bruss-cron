#!/bin/bash

set -euo pipefail

# MongoDB Replication Script - Exact Mirror
# Creates an exact copy of production database on localhost

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

CONFIG_FILE="$SCRIPT_DIR/.env.replication"
LOG_DIR="$SCRIPT_DIR/logs"
BACKUP_DIR="$ROOT_DIR/backups"

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
LOG_FILE="$LOG_DIR/replication-$TIMESTAMP.log"
TEMP_DUMP_DIR="$BACKUP_DIR/dump-$TIMESTAMP"

AUTO_CONFIRM=false
VERBOSE=false
KEEP_DUMP=false
COLLECTIONS=""
EXCLUDE_COLLECTIONS=""

usage() {
    cat << EOF
MongoDB Replication Script - Exact Mirror

Usage: $0 [OPTIONS]

This script creates an EXACT mirror of the production database by:
1. Dumping the production database
2. DROPPING the local database completely
3. Restoring production data to local

OPTIONS:
    --yes                   Skip confirmation prompts
    --verbose              Show detailed output
    --keep-dump            Keep dump files after restoration
    --collections LIST     Only replicate specific collections (comma-separated)
    --exclude LIST         Exclude specific collections (comma-separated)
    --help                 Show this help message

EXAMPLES:
    $0                                    # Full mirror replication
    $0 --yes                             # Skip confirmation
    $0 --collections users,deviations    # Only specific collections
    $0 --exclude scans_archive,logs      # Exclude large collections

EOF
}

log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date "+%Y-%m-%d %H:%M:%S")
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

log_info() {
    log "INFO" "$@"
    if [[ "$VERBOSE" == "true" ]]; then
        echo "ℹ️  $*"
    fi
}

log_warn() {
    log "WARN" "$@"
    echo "⚠️  $*" >&2
}

log_error() {
    log "ERROR" "$@"
    echo "❌ $*" >&2
}

log_success() {
    log "SUCCESS" "$@"
    echo "✅ $*"
}

step() {
    local step_num="$1"
    local step_desc="$2"
    echo ""
    echo "[$step_num/6] $step_desc..."
    log_info "Starting step $step_num: $step_desc"
}

check_dependencies() {
    local missing_deps=()

    if ! command -v mongodump &> /dev/null; then
        missing_deps+=("mongodump")
    fi

    if ! command -v mongorestore &> /dev/null; then
        missing_deps+=("mongorestore")
    fi

    if ! command -v mongosh &> /dev/null; then
        missing_deps+=("mongosh")
    fi

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing required dependencies: ${missing_deps[*]}"
        echo ""
        echo "Please install MongoDB tools:"
        echo "  brew install mongodb/brew/mongodb-database-tools"
        echo "  brew install mongodb/brew/mongodb-community"
        exit 1
    fi
}

load_config() {
    if [[ ! -f "$CONFIG_FILE" ]]; then
        log_error "Configuration file not found: $CONFIG_FILE"
        echo ""
        echo "Please create the configuration file first:"
        echo "  cp $SCRIPT_DIR/.env.replication.example $CONFIG_FILE"
        echo "  # Edit the configuration file with your settings"
        exit 1
    fi

    # shellcheck source=/dev/null
    source "$CONFIG_FILE"

    if [[ -z "${SOURCE_URI:-}" || -z "${TARGET_URI:-}" || -z "${SOURCE_DB:-}" || -z "${TARGET_DB:-}" ]]; then
        log_error "Missing required configuration variables"
        echo ""
        echo "Required variables: SOURCE_URI, TARGET_URI, SOURCE_DB, TARGET_DB"
        exit 1
    fi

    log_info "Configuration loaded successfully"
}

validate_connections() {
    step 1 "Validating connections"

    log_info "Testing source connection..."
    if ! mongosh --quiet "$SOURCE_URI" --eval "db.runCommand('ping')" &>/dev/null; then
        log_error "Cannot connect to source database: $SOURCE_URI"
        exit 1
    fi
    log_success "Source connection validated"

    log_info "Testing target connection..."
    if ! mongosh --quiet "$TARGET_URI" --eval "db.runCommand('ping')" &>/dev/null; then
        log_error "Cannot connect to target database: $TARGET_URI"
        exit 1
    fi
    log_success "Target connection validated"

    log_info "Checking source database exists..."
    if ! mongosh --quiet "$SOURCE_URI" --eval "db.getSiblingDB('$SOURCE_DB').runCommand('listCollections')" &>/dev/null; then
        log_error "Source database '$SOURCE_DB' not accessible"
        exit 1
    fi
    log_success "Source database verified"
}

confirm_operation() {
    if [[ "$AUTO_CONFIRM" == "true" ]]; then
        return 0
    fi

    echo ""
    echo "MongoDB Replication Script"
    echo "=========================="
    echo "Source: $(echo "$SOURCE_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')/$SOURCE_DB"
    echo "Target: $(echo "$TARGET_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')$TARGET_DB"
    echo ""
    echo "⚠️  WARNING: This will DROP the local database '$TARGET_DB' completely!"
    echo "All existing data in the target database will be LOST."
    echo ""

    if [[ -n "$COLLECTIONS" ]]; then
        echo "📋 Only these collections will be replicated: $COLLECTIONS"
        echo ""
    fi

    if [[ -n "$EXCLUDE_COLLECTIONS" ]]; then
        echo "🚫 These collections will be excluded: $EXCLUDE_COLLECTIONS"
        echo ""
    fi

    read -rp "Continue? (y/N): " response
    if [[ ! "$response" =~ ^[Yy]$ ]]; then
        echo "Operation cancelled."
        exit 0
    fi
}

dump_production() {
    step 2 "Dumping production database"

    local dump_args=(
        --uri="$SOURCE_URI"
        --db="$SOURCE_DB"
        --out="$TEMP_DUMP_DIR"
        --gzip
    )

    if [[ -n "$COLLECTIONS" ]]; then
        IFS=',' read -ra COLLECTION_ARRAY <<< "$COLLECTIONS"
        for collection in "${COLLECTION_ARRAY[@]}"; do
            dump_args+=(--collection="$collection")
        done
    fi

    if [[ -n "$EXCLUDE_COLLECTIONS" ]]; then
        IFS=',' read -ra EXCLUDE_ARRAY <<< "$EXCLUDE_COLLECTIONS"
        for collection in "${EXCLUDE_ARRAY[@]}"; do
            dump_args+=(--excludeCollection="$collection")
        done
    fi

    log_info "Starting mongodump with args: ${dump_args[*]}"

    if [[ "$VERBOSE" == "true" ]]; then
        mongodump "${dump_args[@]}"
    else
        mongodump "${dump_args[@]}" 2>&1 | grep -E "(done dumping|writing)" | while read -r line; do
            echo "  📦 $line"
        done
    fi

    local dump_size=$(du -sh "$TEMP_DUMP_DIR" | cut -f1)
    log_success "Production database dumped (Size: $dump_size)"
}

drop_local_database() {
    step 3 "Dropping local database"

    log_warn "Dropping database '$TARGET_DB' on target server..."

    mongosh --quiet "$TARGET_URI" --eval "
        db.getSiblingDB('$TARGET_DB').dropDatabase();
        print('Database $TARGET_DB dropped successfully');
    " 2>&1 | grep -v "^$" | while read -r line; do
        log_info "MongoDB: $line"
    done

    log_success "Local database dropped"
}

restore_to_local() {
    step 4 "Restoring to local database"

    local restore_args=(
        --uri="$TARGET_URI"
        --nsFrom="$SOURCE_DB.*"
        --nsTo="$TARGET_DB.*"
        --gzip
        --numParallelCollections=4
        --dir="$TEMP_DUMP_DIR"
    )

    log_info "Starting mongorestore with args: ${restore_args[*]}"

    if [[ "$VERBOSE" == "true" ]]; then
        mongorestore "${restore_args[@]}"
    else
        mongorestore "${restore_args[@]}" 2>&1 | grep -E "(done|finished)" | while read -r line; do
            echo "  📥 $line"
        done
    fi

    log_success "Database restored to local"
}

verify_replication() {
    step 5 "Verifying replication"

    log_info "Counting collections and documents..."

    local verification_result
    verification_result=$(mongosh --quiet "$TARGET_URI" --eval "
        var db_target = db.getSiblingDB('$TARGET_DB');
        var collections = db_target.getCollectionNames();
        var totalDocs = 0;
        collections.forEach(function(collection) {
            totalDocs += db_target[collection].countDocuments();
        });
        print('Collections: ' + collections.length);
        print('Documents: ' + totalDocs);
    " 2>/dev/null)

    echo "$verification_result" | while read -r line; do
        if [[ -n "$line" ]]; then
            echo "  📊 $line"
            log_info "Verification: $line"
        fi
    done

    log_success "Replication verified"
}

cleanup() {
    step 6 "Cleaning up"

    if [[ "$KEEP_DUMP" == "true" ]]; then
        log_info "Keeping dump files at: $TEMP_DUMP_DIR"
        echo "  📁 Dump files preserved at: $TEMP_DUMP_DIR"
    else
        log_info "Removing temporary dump files..."
        rm -rf "$TEMP_DUMP_DIR"
        log_success "Temporary files cleaned up"
    fi

    # Keep only last 5 log files
    find "$LOG_DIR" -name "replication-*.log" -type f | sort -r | tail -n +6 | xargs -r rm -f
    log_info "Old log files cleaned up"

    log_success "Cleanup completed"
}

show_summary() {
    local end_time=$(date)
    local duration=$((SECONDS / 60))
    local seconds=$((SECONDS % 60))

    echo ""
    echo "✅ Replication completed successfully!"
    echo ""
    echo "Summary:"
    echo "--------"
    echo "Source: $SOURCE_DB @ $(echo "$SOURCE_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')"
    echo "Target: $TARGET_DB @ $(echo "$TARGET_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')"
    echo "Duration: ${duration}m ${seconds}s"
    echo "Log file: $LOG_FILE"
    echo ""

    log_success "Replication completed in ${duration}m ${seconds}s"
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --yes)
                AUTO_CONFIRM=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --keep-dump)
                KEEP_DUMP=true
                shift
                ;;
            --collections)
                COLLECTIONS="$2"
                shift 2
                ;;
            --exclude)
                EXCLUDE_COLLECTIONS="$2"
                shift 2
                ;;
            --help)
                usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
        esac
    done
}

main() {
    echo "MongoDB Exact Mirror Replication Script"
    echo "======================================="
    echo ""

    mkdir -p "$LOG_DIR" "$BACKUP_DIR"

    log_info "Starting replication process at $(date)"
    log_info "Script arguments: $*"

    check_dependencies
    load_config
    confirm_operation
    validate_connections
    dump_production
    drop_local_database
    restore_to_local
    verify_replication
    cleanup
    show_summary
}

# Parse command line arguments
parse_args "$@"

# Run main function
main "$@"