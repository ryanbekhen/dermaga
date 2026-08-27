package store

import "testing"

// Every bucket a caller can name has to exist by the time Open returns, because
// Put refuses a bucket that is not there -- "no bucket %q" -- and the refusal
// only shows up the first time somebody writes.
//
// This exists because that is exactly what happened: a bucket constant was
// added without being added to the list Open creates, and nothing said so until
// a project was made and could not be saved. A constant here and a name in that
// list are two halves of the same fact, and nothing but this test was holding
// them together.
func TestOpenCreatesEveryBucket(t *testing.T) {
	inTempHome(t)
	store := openStore(t)

	named := []string{
		BucketScans, BucketTemplates, BucketPending, BucketPorts, BucketContainers,
		BucketTasks, BucketTunnels, BucketNotices, BucketProjects, BucketImages, BucketVolumes,
	}

	for _, bucket := range named {
		if err := store.Put(bucket, "probe", map[string]string{"a": "b"}); err != nil {
			t.Errorf("bucket %q is not created by Open: %v", bucket, err)
		}
	}
}
