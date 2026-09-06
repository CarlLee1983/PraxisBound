.PHONY: verify verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions verify-portability release-check

verify: verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions

release-check: verify
	./scripts/release-check

verify-protocol:
	sh -n tests/protocol.sh tests/code-quality.sh tests/human-review.sh tests/review-integrity.sh
	./tests/protocol.sh
	./tests/code-quality.sh
	./tests/human-review.sh
	./tests/review-integrity.sh

verify-bootstrap:
	sh -n scripts/bootstrap tests/bootstrap.sh
	./tests/bootstrap.sh
	sh -n scripts/codex-activate tests/codex-activation.sh
	sh -n specs/stories/FF-223-codex-project-activation/walkthrough-fixtures.sh
	./tests/codex-activation.sh

verify-doctor:
	sh -n scripts/doctor tests/doctor.sh
	./tests/doctor.sh

verify-story:
	sh -n scripts/story-check tests/story-check.sh
	./tests/story-check.sh
	./scripts/story-check
	./scripts/story-check examples/*/specs/stories/*

verify-handoff:
	sh -n scripts/handoff-check tests/handoff-check.sh
	./tests/handoff-check.sh
	./scripts/handoff-check

verify-release:
	sh -n scripts/release-check tests/release-check.sh
	./tests/release-check.sh

verify-typescript:
	$(MAKE) -C examples/typescript verify

verify-go:
	$(MAKE) -C examples/go verify

verify-actions:
	go -C examples/go tool actionlint \
		../../templates/ci/github-actions.yml ../../.github/workflows/verify.yml

PORTABILITY_SHELL ?= /bin/sh

verify-portability:
	PORTABILITY_SHELL="$(PORTABILITY_SHELL)" sh ./tests/portability.sh
