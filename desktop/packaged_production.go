//go:build production

package main

// A build carrying the production tag is the one that ships: it takes the
// installed app's socket and finds its agent in the bundle's Resources.
const isPackaged = true
