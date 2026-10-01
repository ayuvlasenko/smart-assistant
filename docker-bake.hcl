variable "REGISTRY" {
  default = ""
}

variable "SHORT_SHA" {
  default = "latest"
}

group "default" {
  targets = ["server"]
}

target "server" {
  dockerfile = "server.dockerfile"
  tags       = ["${REGISTRY}/smart-assistant-server:${SHORT_SHA}"]
  cache-from = ["type=registry,ref=${REGISTRY}/smart-assistant-server:buildcache"]
  cache-to   = ["type=registry,ref=${REGISTRY}/smart-assistant-server:buildcache,mode=max,image-manifest=true,oci-mediatypes=true"]
}
