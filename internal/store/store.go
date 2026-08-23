// Package store is where Dermaga keeps what it has worked out.
//
// Everything in here is a cache: scan results, the template catalogue, an edit
// begun and not finished. None of it is authored by anybody, none of it is
// worth reading by hand, and losing all of it costs a rescan and a fetch. That
// is what decides the shape of it.
//
// One file rather than several. ~/.dermaga was four JSON files and growing,
// and each one was a thing a person could open, edit and quietly corrupt --
// which for a cache is a bug report about data nobody wrote. A single binary
// file is tidier on their disk and harder to break by accident.
//
// User settings are deliberately not here. ~/.dermaga/config.json stays JSON
// and stays hand-editable: those are somebody's preferences, they survive a
// reinstall, and being able to open one in an editor is a feature of it rather
// than a risk to it.
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	bolt "go.etcd.io/bbolt"
)

// The buckets, one per thing that used to be a file of its own.
const (
	BucketScans     = "scans"
	BucketTemplates = "templates"
	BucketPending   = "pending"
	// What each image declares it listens on, keyed by digest. Read from the
	// image itself; kept here because a container can outlive the image it was
	// made from, and then there is nowhere left to read it.
	BucketPorts = "ports"
	// What Dermaga keeps about a container that the runtime has no place for,
	// keyed by name. Somewhere for a setting to live that can be changed
	// without destroying the container to write it down.
	BucketContainers = "containers"
)

// Name of the database inside ~/.dermaga.
const fileName = "dermaga.db"

// Store is the whole of Dermaga's own state on disk.
type Store struct {
	db *bolt.DB
}

// Dir is ~/.dermaga, the directory everything Dermaga writes lives in.
func Dir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, ".dermaga"), nil
}

// Open prepares the database, creating it and its buckets if they are not
// there yet.
//
// The lock timeout is short and deliberate. bbolt takes an exclusive lock on
// the file, so a second Dermaga -- a stale background service, a copy launched
// twice -- would otherwise block here for ever with no window and nothing to
// say. Failing quickly lets the caller carry on without a cache instead.
func Open() (*Store, error) {
	dir, err := Dir()
	if err != nil {
		return nil, err
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}

	db, err := bolt.Open(filepath.Join(dir, fileName), 0o600, &bolt.Options{Timeout: 2 * time.Second})
	if err != nil {
		return nil, err
	}

	err = db.Update(func(tx *bolt.Tx) error {
		buckets := []string{
			BucketScans, BucketTemplates, BucketPending, BucketPorts, BucketContainers,
		}

		for _, name := range buckets {
			if _, err := tx.CreateBucketIfNotExists([]byte(name)); err != nil {
				return err
			}
		}

		return nil
	})
	if err != nil {
		db.Close()
		return nil, err
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}

	return s.db.Close()
}

// Put writes one value, encoded as JSON.
//
// JSON inside a binary store rather than something denser on purpose: these
// are the same structs the API hands to the window, the volume is tiny, and a
// format the standard library can read is one less thing that can go wrong
// than a format only this program understands.
func (s *Store) Put(bucket, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}

	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return fmt.Errorf("no bucket %q", bucket)
		}

		return b.Put([]byte(key), raw)
	})
}

// Delete removes one value. A key that was not there is not an error.
func (s *Store) Delete(bucket, key string) error {
	return s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}

		return b.Delete([]byte(key))
	})
}

// Get reads one value into out, and reports whether it was there at all.
func (s *Store) Get(bucket, key string, out any) (bool, error) {
	found := false

	err := s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}

		raw := b.Get([]byte(key))
		if raw == nil {
			return nil
		}

		found = true

		return json.Unmarshal(raw, out)
	})

	return found, err
}

// All decodes every value in a bucket, calling decode once per key.
//
// The value handed to decode is only valid for the length of the call: bbolt
// reads come straight out of the memory-mapped file, so anything kept has to
// be copied. Decoding into a struct does that copying, which is why this hands
// over the bytes rather than returning them.
func (s *Store) All(bucket string, decode func(key string, raw []byte) error) error {
	return s.db.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		if b == nil {
			return nil
		}

		return b.ForEach(func(key, raw []byte) error {
			return decode(string(key), raw)
		})
	})
}

// Replace writes a whole bucket at once, emptying it first.
//
// For the stores that are a snapshot rather than a set of independent records
// -- the template catalogue is fetched whole or not at all -- and for them the
// alternative is working out which keys went, which is a way of getting it
// wrong.
func (s *Store) Replace(bucket string, values map[string]any) error {
	encoded := make(map[string][]byte, len(values))
	for key, value := range values {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}

		encoded[key] = raw
	}

	return s.db.Update(func(tx *bolt.Tx) error {
		if err := tx.DeleteBucket([]byte(bucket)); err != nil && err != bolt.ErrBucketNotFound {
			return err
		}

		b, err := tx.CreateBucket([]byte(bucket))
		if err != nil {
			return err
		}

		for key, raw := range encoded {
			if err := b.Put([]byte(key), raw); err != nil {
				return err
			}
		}

		return nil
	})
}
