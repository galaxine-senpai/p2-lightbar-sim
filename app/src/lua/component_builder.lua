-- Ported verbatim from lua/photon-v2/sh_component_builder.lua (Photon 2, MIT).
-- Only the pure state-map parsing helper is needed for authoring-time data
-- extraction; the rest of that file deals with live entity compilation and
-- is reimplemented separately on the JS side per documented semantics.

local string = string

function Photon2.ComponentBuilder.StateMap(colorMap, lightGroups, stateSlots)
	colorMap = string.Replace(colorMap, "\n", " ")
	colorMap = string.Replace(colorMap, "\t", " ")
	colorMap = string.Trim(colorMap)
	while string.find(colorMap, "  ") do
		colorMap = string.Replace(colorMap, "  ", " ")
	end

	local blocks = string.Split(colorMap, " ")

	local validatedStateSlot = false

	local result = {}

	local current
	for i = 1, #blocks do
		local block = blocks[i]
		if (block == "") then goto continue end
		if (string.StartsWith(block, "[")) then
			block = string.sub(block, 2, string.len(block) - 1)
			block = string.Replace(block, " ", "")
			current = string.Split(block, "/")

			for j = 1, #current do
				local asNumber = tonumber(current[j])
				if (asNumber) then
					if (not validatedStateSlot) then
						if (not istable(stateSlots)) then
							error("Failed to setup StateMap because StateSlots is invalid. Ensure you have COMPONENT.States = {} configured.")
						end
						if (not stateSlots[asNumber]) then
							error("Failed to setup StateMap because slot [" .. tostring(current[j]) .. "] is not defined in COMPONENT.States.")
						end
						validatedStateSlot = true
					end
					current[j] = stateSlots[asNumber]
				end
			end
		else
			local asNumber = tonumber(block)
			if (not isnumber(asNumber)) then
				local group = lightGroups[block]
				if (not group) then
					error(string.format("Invalid light group [%s]", block))
				end
				for gi = 1, #group do
					result[group[gi]] = current
				end
			elseif (asNumber) then
				result[asNumber] = current
			else
				error("StateMap parsing failed. Received: [" .. tostring(colorMap) .. "]")
			end
		end
		::continue::
	end

	return result
end
