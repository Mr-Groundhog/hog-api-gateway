package authz

const (
	ResourceProxy = "proxy"
)

var (
	ProxyRead    = Permission{Resource: ResourceProxy, Action: ActionRead}
	ProxyOperate = Permission{Resource: ResourceProxy, Action: ActionOperate}
	ProxyWrite   = Permission{Resource: ResourceProxy, Action: ActionWrite}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceProxy,
		LabelKey: "Proxy Pool",
		Actions: []ActionDefinition{
			{
				Action:         ActionRead,
				LabelKey:       "Read proxy pool",
				DescriptionKey: "View proxy addresses, latency, exit IP, and availability.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionOperate,
				LabelKey:       "Operate proxy pool",
				DescriptionKey: "Test proxies, enable or disable entries, and delete entries that failed their last check.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionWrite,
				LabelKey:       "Edit proxy pool",
				DescriptionKey: "Add, edit, import, and delete proxy credentials.",
			},
		},
	})
}
