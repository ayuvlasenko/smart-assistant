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
}
