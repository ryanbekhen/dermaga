package machines

import "testing"

// The runtime will not boot a machine in less than a gibibyte -- and it says so
// only after fetching and unpacking the image, which is the better part of a
// minute spent to be told a number was too small.
//
// Its own words: `invalid memory value '512mb'. Must be greater than 1gb`. A
// gibibyte exactly is accepted, so this is a floor rather than a threshold to
// clear.
func TestAMachineWillNotBootInLessThanAGibibyte(t *testing.T) {
	tooSmall := Spec{Image: "alpine:3.22", Memory: "512M"}
	if err := tooSmall.Validate(); err == nil {
		t.Error("512M was accepted; the runtime would have refused it after the pull")
	}

	for _, memory := range []string{"1G", "1024M", "2G", "4096m", ""} {
		spec := Spec{Image: "alpine:3.22", Memory: memory}
		if err := spec.Validate(); err != nil {
			t.Errorf("memory %q: %v", memory, err)
		}
	}
}

// Everything else the spec refuses, so the rule above is not the only thing
// standing between a typo and a minute of waiting.
func TestASpecSaysWhatIsWrongWithIt(t *testing.T) {
	if err := (Spec{}).Validate(); err == nil {
		t.Error("a machine with no image was accepted")
	}
	if err := (Spec{Image: "alpine:3.22", Name: "my machine"}).Validate(); err == nil {
		t.Error("a name with a space in it was accepted")
	}
	if err := (Spec{Image: "alpine:3.22", HomeMount: "maybe"}).Validate(); err == nil {
		t.Error("an unknown home mount was accepted")
	}
}
