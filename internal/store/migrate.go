package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

// NOTE: TEMPORARY — remove this file, and the call to Migrate, in 1.15.0.
//
// Every one of these files was written by a version of Dermaga at or before
// 1.9.0. Once no version anybody could be upgrading from still writes them,
// this code is reading for a format nothing produces and the whole file can
// go, along with `legacyFiles` and the Migrate call in the agent.
//
// 1.15.0 is six releases out. Somebody upgrading from 1.9.0 or later is still
// carried across; somebody who skipped further back than that loses their scan
// results, which costs them one slow first launch and nothing else -- all of
// it is cache. Deleting it later costs nothing but the file being here.
//
// The one thing that must not happen is deleting the *reader* while leaving
// the old files behind: that would strand data on disk with nothing left that
// knows what it is. So the reader and the clean-up go together, or not at all.

// legacyFiles maps each JSON file Dermaga used to write to the bucket its
// contents now belong in.
//
// Only the files something now reads out of the database. A file is deleted
// once its contents are in a bucket, so listing one whose bucket nothing reads
// would move the data somewhere nobody looks and then remove the copy that
// worked -- data lost to a tidy-up. Adding a file here means the manager that
// owned it already reads from its bucket.
//
// config.json is not here and never will be. It holds somebody's settings, it
// is meant to be readable and editable by hand, and it stays where it is.
var legacyFiles = []struct {
	name   string
	bucket string
	// read turns one file's bytes into the records to write, keyed as the
	// bucket keys them.
	read func(raw []byte, modTime time.Time) (map[string]any, error)
}{
	{
		name:   "scans.json",
		bucket: BucketScans,
		// { "reports": { "<image reference>": { … } } } — one record per image.
		read: func(raw []byte, _ time.Time) (map[string]any, error) {
			var file struct {
				Reports map[string]json.RawMessage `json:"reports"`
			}
			if err := json.Unmarshal(raw, &file); err != nil {
				return nil, err
			}

			return spread(file.Reports), nil
		},
	},
	{
		name:   "templates.json",
		bucket: BucketTemplates,
		// The catalogue, fetched whole and kept under one key. Its age used to
		// be the file's modification time; the record carries its own now, and
		// the file's is what that time was.
		read: func(raw []byte, modTime time.Time) (map[string]any, error) {
			var catalogue json.RawMessage
			if err := json.Unmarshal(raw, &catalogue); err != nil {
				return nil, err
			}

			return map[string]any{
				"catalogue": map[string]any{"fetchedAt": modTime, "raw": catalogue},
			}, nil
		},
	},
	{
		name:   "pending-edits.json",
		bucket: BucketPending,
		// { "<container id>": { … } } — one record per unfinished edit.
		read: func(raw []byte, _ time.Time) (map[string]any, error) {
			var edits map[string]json.RawMessage
			if err := json.Unmarshal(raw, &edits); err != nil {
				return nil, err
			}

			return spread(edits), nil
		},
	},
}

func spread(records map[string]json.RawMessage) map[string]any {
	out := make(map[string]any, len(records))
	for key, value := range records {
		out[key] = value
	}

	return out
}

// Migrate moves anything left in the old JSON files into the database and then
// removes them, so an upgraded install is not left carrying both.
//
// Nothing here is fatal. All of it is cache: a file that cannot be read is a
// file whose contents will be worked out again, and saying so in the log is
// the whole of the response. What is never done is deleting a file that failed
// to import -- that would turn "we could not read this" into "this is gone".
func Migrate(s *Store, logger *slog.Logger) {
	dir, err := Dir()
	if err != nil {
		return
	}

	for _, legacy := range legacyFiles {
		path := filepath.Join(dir, legacy.name)

		raw, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			continue // Already migrated, or never written.
		}
		if err != nil {
			logger.Warn("Could not read a file to migrate", "file", legacy.name, "error", err)
			continue
		}

		// When the file was last written, which for the catalogue is when it
		// was fetched. Zero if it cannot be read, which only makes a copy look
		// old enough to fetch again.
		var modTime time.Time
		if info, err := os.Stat(path); err == nil {
			modTime = info.ModTime()
		}

		if err := importInto(s, legacy.bucket, raw, modTime, legacy.read); err != nil {
			logger.Warn("Could not migrate a file", "file", legacy.name, "error", err)
			continue
		}

		if err := os.Remove(path); err != nil {
			logger.Warn("Migrated a file but could not remove it", "file", legacy.name, "error", err)
			continue
		}

		logger.Info("Migrated into the database", "file", legacy.name, "bucket", legacy.bucket)
	}
}

// importInto writes one legacy file's records, leaving anything already in the
// bucket alone.
//
// Merged rather than replaced because the database is authoritative from the
// moment it exists: if a scan has already run and written a fresher result,
// the file on disk is the older answer and must not overwrite it.
func importInto(
	s *Store,
	bucket string,
	raw []byte,
	modTime time.Time,
	read func(raw []byte, modTime time.Time) (map[string]any, error),
) error {
	// An empty or blank file is nothing to import, and is not a failure worth
	// keeping the file around for.
	if len(raw) == 0 {
		return nil
	}

	records, err := read(raw, modTime)
	if err != nil {
		return fmt.Errorf("could not read the old format: %w", err)
	}

	for key, value := range records {
		var existing json.RawMessage
		if found, err := s.Get(bucket, key, &existing); err == nil && found {
			continue
		}

		if err := s.Put(bucket, key, value); err != nil {
			return err
		}
	}

	return nil
}
