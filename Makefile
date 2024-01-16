platforms := linux/amd64 linux/i386 linux/arm32v7 linux/arm64v8

os = $(word 1, $(subst /, ,$@))
arch = $(word 2, $(subst /, ,$@))

version = v1.5.1

# to run under WSL use: make DOCKER=/mnt/c/Progra~1/Docker/Docker/resources/bin/docker.exe <TARGET>
DOCKER = $(shell which docker)

.PHONY: build squash manifest push publish clean quick debug deps

%/build:
	$(DOCKER) build --build-arg PLATFORM=$(arch) \
	  -t jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version) .

%/squash:
	$(DOCKER) build --squash --build-arg PLATFORM=$(arch) \
	  -t jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version) .

%/manifest: 
	$(DOCKER) manifest create --amend jeffersonjhunt/shinysdr:latest \
	  jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version)
	$(DOCKER) manifest create --amend jeffersonjhunt/shinysdr:$(version) \
	  jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version)

%/push:
	$(DOCKER) push jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version)

publish: manifest
	$(DOCKER) manifest push --purge jeffersonjhunt/shinysdr:$(version)
	$(DOCKER) manifest push --purge jeffersonjhunt/shinysdr:latest

%/clean:
	$(DOCKER) rmi jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version)

clean:
	rm -f assets/get-pip.py
	rm -f assets/wsjtx-2.1.2.tgz
	rmdir assets

	for p in $(platforms); do \
		$(MAKE) $$p/clean; \
	done

deps:
	mkdir -p assets
	curl -k https://bootstrap.pypa.io/get-pip.py -o assets/get-pip.py
	curl -k https://physics.princeton.edu/pulsar/K1JT/wsjtx-2.1.2.tgz -o assets/wsjtx-2.1.2.tgz

%/run:
	$(DOCKER) run --rm -p 8100:8100 -p 8101:8101 -v ~/.shinysdr:/config \
	  jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version) start /config/my-config

%/debug: 
	$(DOCKER) run --rm -it --entrypoint /bin/bash jeffersonjhunt/shinysdr:$(os)-$(arch)-$(version)

include tools.mak
