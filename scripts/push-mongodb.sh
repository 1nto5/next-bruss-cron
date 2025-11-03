#!/bin/bash

set -euo pipefail

# MongoDB Push Script - Local ➜ Production
# Replaces production database with the current local database state

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

CONFIG_FILE="$SCRIPT_DIR/.env.push"
LOG_DIR="$SCRIPT_DIR/logs"
BACKUP_DIR="$ROOT_DIR/backups"

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
LOG_FILE="$LOG_DIR/push-$TIMESTAMP.log"
TEMP_DUMP_DIR="$BACKUP_DIR/local-dump-$TIMESTAMP"

AUTO_CONFIRM=false
VERBOSE=false
KEEP_DUMP=false
COLLECTIONS=""
EXCLUDE_COLLECTIONS=""
SKIP_ARCHIVE=false

usage() {
    cat << EOF
MongoDB Push Script - Local ➜ Production

Usage: $0 [OPTIONS]

This script will DROP the production database and replace it with your local database.

Steps performed:
1. Dump local database
2. DROP production database completely
3. Restore local dump into production

OPTIONS:
    --yes                   Skip confirmation prompts
    --verbose              Show detailed output
    --keep-dump            Keep dump files after restoration
    --collections LIST     Only push specific collections (comma-separated)
    --exclude LIST         Exclude specific collections (comma-separated)
    --skip-archive         Skip collections with 'archive' in their names
    --help                 Show this help message

EXAMPLES:
    $0                                        # Interactive push
    $0 --yes --skip-archive                  # Non-interactive push, skip archive collections
    $0 --collections users,deviations --yes  # Push selected collections only

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
        echo "  cp $SCRIPT_DIR/.env.push.example $CONFIG_FILE"
        echo "  # Edit the configuration file with your settings"
        exit 1
    fi

    # shellcheck source=/dev/null
    source "$CONFIG_FILE"

    if [[ -z "${LOCAL_URI:-}" || -z "${LOCAL_DB:-}" || -z "${PRODUCTION_URI:-}" || -z "${PRODUCTION_DB:-}" ]]; then
        log_error "Missing required configuration variables"
        echo ""
        echo "Required variables: LOCAL_URI, LOCAL_DB, PRODUCTION_URI, PRODUCTION_DB"
        exit 1
    fi

    SOURCE_URI="$LOCAL_URI"
    SOURCE_DB="$LOCAL_DB"
    TARGET_URI="$PRODUCTION_URI"
    TARGET_DB="$PRODUCTION_DB"

    log_info "Configuration loaded successfully"
}

validate_connections() {
    step 1 "Validating connections"

    log_info "Testing local source connection..."
    if ! mongosh --quiet "$SOURCE_URI" --eval "db.runCommand('ping')" &>/dev/null; then
        log_error "Cannot connect to local source database: $SOURCE_URI"
        exit 1
    fi
    log_success "Local connection validated"

    log_info "Testing production target connection..."
    if ! mongosh --quiet "$TARGET_URI" --eval "db.runCommand('ping')" &>/dev/null; then
        log_error "Cannot connect to production database: $TARGET_URI"
        exit 1
    fi
    log_success "Production connection validated"

    log_info "Checking local database exists..."
    if ! mongosh --quiet "$SOURCE_URI" --eval "db.getSiblingDB('$SOURCE_DB').runCommand('listCollections')" &>/dev/null; then
        log_error "Local database '$SOURCE_DB' not accessible"
        exit 1
    fi
    log_success "Local database verified"
}

show_interactive_menu() {
    if [[ "$AUTO_CONFIRM" == "true" ]]; then
        return 0
    fi

    echo ""
    echo "MongoDB Push Script"
    echo "===================="
    echo "Source (local): $(echo "$SOURCE_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')/$SOURCE_DB"
    echo "Target (production): $(echo "$TARGET_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')$TARGET_DB"
    echo ""

    while true; do
        echo "Current Options:"
        echo "---------------"

        if [[ -n "$COLLECTIONS" ]]; then
            echo "📋 Specific collections: $COLLECTIONS"
        elif [[ -n "$EXCLUDE_COLLECTIONS" || "$SKIP_ARCHIVE" == "true" ]]; then
            echo "📋 Mode: Push with exclusions"
        else
            echo "📋 Mode: Full push (all collections)"
        fi

        if [[ -n "$EXCLUDE_COLLECTIONS" ]]; then
            echo "🚫 Excluded collections: $EXCLUDE_COLLECTIONS"
        fi

        if [[ "$SKIP_ARCHIVE" == "true" ]]; then
            echo "📁 Skip archive collections: YES"
        else
            echo "📁 Skip archive collections: NO"
        fi

        if [[ "$VERBOSE" == "true" ]]; then
            echo "🗣️  Verbose output: YES"
        else
            echo "🗣️  Verbose output: NO"
        fi

        if [[ "$KEEP_DUMP" == "true" ]]; then
            echo "💾 Keep dump files: YES"
        else
            echo "💾 Keep dump files: NO"
        fi

        echo ""
        echo "Options:"
        echo "1) Skip archive collections (toggle)"
        echo "2) Set specific collections to push"
        echo "3) Set collections to exclude"
        echo "4) Toggle verbose output"
        echo "5) Toggle keep dump files"
        echo "6) Reset to full push"
        echo "c) Continue with current settings"
        echo "q) Quit"
        echo ""

        read -rp "Choose option [1-6, c, q]: " choice

        case $choice in
            1)
                if [[ "$SKIP_ARCHIVE" == "true" ]]; then
                    SKIP_ARCHIVE=false
                    log_info "Archive collections will now be included"
                else
                    SKIP_ARCHIVE=true
                    log_info "Archive collections will now be skipped"
                fi
                echo ""
                ;;
            2)
                echo ""
                read -rp "Enter collections to push (comma-separated) or press Enter to clear: " input
                COLLECTIONS="$input"
                if [[ -n "$COLLECTIONS" ]]; then
                    EXCLUDE_COLLECTIONS=""
                    log_info "Set specific collections: $COLLECTIONS"
                else
                    log_info "Cleared specific collections filter"
                fi
                echo ""
                ;;
            3)
                echo ""
                read -rp "Enter collections to exclude (comma-separated) or press Enter to clear: " input
                EXCLUDE_COLLECTIONS="$input"
                if [[ -n "$EXCLUDE_COLLECTIONS" ]]; then
                    COLLECTIONS=""
                    log_info "Set excluded collections: $EXCLUDE_COLLECTIONS"
                else
                    log_info "Cleared excluded collections filter"
                fi
                echo ""
                ;;
            4)
                if [[ "$VERBOSE" == "true" ]]; then
                    VERBOSE=false
                    log_info "Verbose output disabled"
                else
                    VERBOSE=true
                    log_info "Verbose output enabled"
                fi
                echo ""
                ;;
            5)
                if [[ "$KEEP_DUMP" == "true" ]]; then
                    KEEP_DUMP=false
                    log_info "Dump files will be deleted after restore"
                else
                    KEEP_DUMP=true
                    log_info "Dump files will be kept after restore"
                fi
                echo ""
                ;;
            6)
                COLLECTIONS=""
                EXCLUDE_COLLECTIONS=""
                SKIP_ARCHIVE=false
                log_info "Reset to full push mode"
                echo ""
                ;;
            [Cc])
                break
                ;;
            [Qq])
                echo "Operation cancelled."
                exit 0
                ;;
            *)
                echo "Invalid option. Please choose 1-6, c, or q."
                echo ""
                ;;
        esac
    done
}

confirm_operation() {
    show_interactive_menu

    echo ""
    echo "⚠️  CRITICAL WARNING: This will DROP the production database '$TARGET_DB' completely!"
    echo "All existing production data will be REPLACED with your LOCAL data."
    echo ""

    if [[ -n "$COLLECTIONS" ]]; then
        echo "📋 Only these collections will be pushed: $COLLECTIONS"
        echo ""
    fi

    if [[ -n "$EXCLUDE_COLLECTIONS" ]]; then
        echo "🚫 These collections will be excluded: $EXCLUDE_COLLECTIONS"
        echo ""
    fi

    if [[ "$SKIP_ARCHIVE" == "true" ]]; then
        echo "📁 Collections with 'archive' in their names will be skipped"
        echo ""
    fi

    read -rp "Type 'PUSH' to confirm you want to overwrite production: " confirmation
    if [[ "$confirmation" != "PUSH" ]]; then
        echo "Confirmation failed. Operation cancelled."
        exit 0
    fi
}

dump_local() {
    step 2 "Dumping local database"

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

    if [[ "$SKIP_ARCHIVE" == "true" ]]; then
        log_info "Getting list of collections to identify archive collections..."
        local archive_collections
        archive_collections=$(mongosh --quiet "$SOURCE_URI" --eval "
            db.getSiblingDB('$SOURCE_DB').getCollectionNames().filter(name => name.includes('archive')).forEach(name => print(name))
        " 2>/dev/null || true)

        if [[ -n "$archive_collections" ]]; then
            log_info "Found archive collections to exclude: $archive_collections"
            while IFS= read -r collection; do
                if [[ -n "$collection" ]]; then
                    dump_args+=(--excludeCollection="$collection")
                    log_info "Excluding archive collection: $collection"
                fi
            done <<< "$archive_collections"
        else
            log_info "No archive collections found to exclude"
        fi
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
    log_success "Local database dumped (Size: $dump_size)"
}

drop_production_database() {
    step 3 "Dropping production database"

    log_warn "Dropping production database '$TARGET_DB'..."

    mongosh --quiet "$TARGET_URI" --eval "
        db.getSiblingDB('$TARGET_DB').dropDatabase();
        print('Production database $TARGET_DB dropped successfully');
    " 2>&1 | grep -v "^$" | while read -r line; do
        log_info "MongoDB: $line"
    done

    log_success "Production database dropped"
}

restore_to_production() {
    step 4 "Restoring local dump to production"

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

    log_success "Production database restored from local dump"
}

verify_push() {
    step 5 "Verifying production data"

    log_info "Counting collections and documents in production..."

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

    log_success "Production data verified"
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

    find "$LOG_DIR" -name "push-*.log" -type f | sort -r | tail -n +6 | xargs -r rm -f
    log_info "Old log files cleaned up"

    log_success "Cleanup completed"
}

show_summary() {
    local end_time=$(date)
    local duration=$((SECONDS / 60))
    local seconds=$((SECONDS % 60))

    echo ""
    echo "✅ Push completed successfully!"
    echo ""
    echo "Summary:"
    echo "--------"
    echo "Local source: $SOURCE_DB @ $(echo "$SOURCE_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')"
    echo "Production target: $TARGET_DB @ $(echo "$TARGET_URI" | sed 's/:\/\/[^@]*@/:\/\/***@/')"
    echo "Duration: ${duration}m ${seconds}s"
    echo "Log file: $LOG_FILE"
    echo ""

    log_success "Push completed in ${duration}m ${seconds}s"
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
            --skip-archive)
                SKIP_ARCHIVE=true
                shift
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
    echo "MongoDB Local ➜ Production Push Script"
    echo "====================================="
    echo ""

    mkdir -p "$LOG_DIR" "$BACKUP_DIR"

    log_info "Starting push process at $(date)"
    log_info "Script arguments: $*"

    check_dependencies
    load_config
    confirm_operation
    validate_connections
    dump_local
    drop_production_database
    restore_to_production
    verify_push
    cleanup
    show_summary
}

parse_args "$@"

main "$@"

