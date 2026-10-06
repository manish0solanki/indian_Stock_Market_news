// The site registers both /sw.js and this file for the same scope, and the
// browser keeps only one of them active. Load the shared worker so the active
// one always behaves the same (safe caching + notification clicks).
importScripts('/sw.js');
