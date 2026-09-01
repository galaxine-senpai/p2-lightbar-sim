-- Ported verbatim (color math only) from lua/photon-v2/meta/light_2d.lua's
-- `Light.States` table (Photon 2, MIT) -- the baseline color states every
-- 2D light element has access to unless a component's Template/ElementStates
-- overrides them. Running this through the same real PhotonColor chain as
-- the shim gives byte-exact default colors instead of hand-guessed ones.

local wScale = 0.9
local swScale = 1.0
local bScale = 0.66
local rScale = 0.66

local black = Color( 0, 0, 0 )
local white = { r = 255, g = 255, b = 255 }
local softWhite = { r = 255, g = 225, b = 225 }
local red = { r = 255, g = 0, b = 0 }
local redHalogen = { r = 255, g = 50, b = 70 }
local blue = { r = 0, g = 0, b = 255 }
local green = { r = 0, g = 255, b = 0 }
local amber = { r = 255, g = 0, b = 0 }
local miku = { r = 0, g = 221, b = 192 }

Photon2.DefaultLightStates2D = {
	["~OFF"] = {
		Intensity = 0,
		IntensityTransitions = true,
	},
	["OFF"] = {
		Blend = PhotonColor( 0, 0, 0 ),
		SourceDetailColor = black,
		SourceFillColor = black,
		GlowColor = black,
		SubtractiveMid = black,
		ShapeGlowColor = black,
		InnerGlowColor = black,
		Intensity = 0
	},
	["R"] = {
		Blend = PhotonColor( 255, 0, 0 ),
		SourceFillColor = PhotonColor( 255, 0, 0 ):Negative(true):Blend( red ):GetBlendColor(),
		GlowColor = PhotonColor( 255, 0, 0 ):Negative(true):Blend(red):Scale(0.6):GetBlendColor(),
		SubtractiveMid = PhotonColor( 255, 0, 0 ):Negative(true):Blend(red):Scale(0.6):GetBlendColor(),
		SourceDetailColor = PhotonColor( 255,255,0 ):Blend(red):GetBlendColor(),
		InnerGlowColor = PhotonColor(255, 0, 0):Blend(red):Scale( rScale ):GetBlendColor(),
		ShapeGlowColor = PhotonColor(255, 0, 0):Blend(red):GetBlendColor()
	},
	["B"] = {
		Blend = PhotonColor( 0, 0, 255 ),
		SourceFillColor = PhotonColor(0,0,255):Negative(true):Blend( blue ):GetBlendColor(),
		GlowColor = PhotonColor(48, 0, 255):Negative(true):Blend(blue):Scale(0.6):GetBlendColor(),
		SubtractiveMid = PhotonColor( 0, 0, 255 ):Negative(true):Blend(blue):Scale(0.6):GetBlendColor(),
		InnerGlowColor = PhotonColor(0, 64, 255):Blend(blue):Scale( bScale ):GetBlendColor(),
		SourceDetailColor = PhotonColor(0,255,255):Blend(blue):GetBlendColor(),
		ShapeGlowColor = PhotonColor(0, 0, 255):Blend(blue):GetBlendColor(),
	},
	["G"] = {
		SourceDetailColor = PhotonColor(255,255,0):Blend(green):GetBlendColor(),
		SourceFillColor = PhotonColor(0,200,64):Negative( true ):Blend(green):GetBlendColor(),
		GlowColor = PhotonColor( 32, 255, 64 ):Negative( true ):Blend(green):Scale( 0.4 ):GetBlendColor(),
		InnerGlowColor = PhotonColor( 32, 255, 32 ):Blend(green):Scale( 0.7 ):GetBlendColor(),
		ShapeGlowColor = PhotonColor( 16, 255, 16 ):Blend(green):Scale( 0.5 ):GetBlendColor(),
	},
	["A"] = {
		SourceDetailColor = PhotonColor(255,255,0):Blend(amber):GetBlendColor(),
		SourceFillColor = PhotonColor(200,64,0):Blend(amber):GetBlendColor(),
		GlowColor = PhotonColor( 255, 100, 0 ):Blend(amber):GetBlendColor(),
		InnerGlowColor = PhotonColor( 255, 128, 0 ):Blend(amber):GetBlendColor(),
		ShapeGlowColor = PhotonColor( 255, 128, 0 ):Blend(amber):GetBlendColor(),
	},
	["W"] = {
		Blend = Color( 200, 200, 255 ),
		SourceDetailColor = PhotonColor(255,255,255):Blend(white):GetBlendColor(),
		SourceFillColor = PhotonColor( 255, 255, 255 ):Blend(white):GetBlendColor(),
		GlowColor = PhotonColor(200*wScale, 200*wScale, 255*wScale):Negative(true):Blend(white):GetBlendColor(),
		InnerGlowColor = PhotonColor(150*wScale, 150*wScale, 255*wScale):Blend(white):GetBlendColor(),
		ShapeGlowColor = PhotonColor(255, 255, 255):Blend(white):GetBlendColor(),
	},
	["SW"] = {
		Blend = Color( 255, 200, 200 ),
		SourceDetailColor = PhotonColor(255,255,255):Blend(softWhite):GetBlendColor(),
		SubtractiveMid = PhotonColor( 0, 0, 255 ):Negative(true):Blend(softWhite):GetBlendColor(),
		SourceFillColor = PhotonColor( 255, 255, 255 ):Negative(false):Blend(softWhite):GetBlendColor(),
		GlowColor = PhotonColor(255*swScale, 255*swScale, 200*swScale):Negative(true):Blend(softWhite):GetBlendColor(),
		InnerGlowColor = PhotonColor(255*swScale, 175*swScale, 150*swScale):Blend(softWhite):GetBlendColor(),
		ShapeGlowColor = PhotonColor(255, 255, 255):Blend(softWhite):GetBlendColor(),
	},
	["HR"] = {
		Title = "Halogen Red",
		Blend = PhotonColor( 255, 50, 50 ),
		SourceFillColor = PhotonColor( 255, 0, 0 ):Negative(true):Blend( redHalogen ):GetBlendColor(),
		GlowColor = PhotonColor( 255, 0, 0 ):Negative(true):Blend(redHalogen):Scale(0.6):GetBlendColor(),
		SubtractiveMid = PhotonColor( 255, 0, 0 ):Negative(true):Blend(redHalogen):Scale(0.6):GetBlendColor(),
		SourceDetailColor = PhotonColor( 255,225,0 ):Blend(redHalogen):GetBlendColor(),
		InnerGlowColor = PhotonColor(255, 50, 50):Blend(redHalogen):Scale( rScale ):GetBlendColor(),
		ShapeGlowColor = PhotonColor(255, 48, 48):Blend(redHalogen):GetBlendColor()
	},
	["M"] = {
		SourceDetailColor = PhotonColor(0,255,100):Blend(miku):GetBlendColor(),
		SourceFillColor = PhotonColor(0,64,100):Blend(miku):GetBlendColor(),
		GlowColor = PhotonColor( 0, 100, 100 ):Blend(miku):GetBlendColor(),
		InnerGlowColor = PhotonColor( 0, 128, 100 ):Blend(miku):GetBlendColor(),
		ShapeGlowColor = PhotonColor( 0, 128, 100 ):Blend(miku):GetBlendColor(),
	},
}

-- Ported verbatim (color math only) from lua/photon-v2/meta/light_mesh.lua's
-- `Light.States` table -- the baseline states every Mesh element has access
-- to unless overridden. Uses DrawColor/BloomColor, not the 2D fields above.
local meshWhite = { r = 235, g = 235, b = 255 }
local meshSoftWhite = { r = 255, g = 235, b = 205 }
local meshRed = { r = 255, g = 0, b = 0 }
local meshBlue = { r = 0, g = 0, b = 255 }
local meshGreen = { r = 0, g = 255, b = 0 }
local meshAmber = { r = 255, g = 128, b = 0 }
local meshMiku = { r = 0, g = 221, b = 192 }

Photon2.DefaultLightStatesMesh = {
	["~OFF"] = {
		Intensity = 0,
		IntensityTransitions = true,
	},
	["OFF"] = {
		Intensity = 0,
		BloomColor = PhotonColor( 0, 0, 0 ),
		DrawColor = PhotonColor( 0, 0, 0 ),
	},
	["R"] = {
		BloomColor = PhotonColor( 255, 0, 0 ):Blend( meshRed ):GetBlendColor(),
		DrawColor = PhotonColor( 255, 128, 0 ):Blend( meshRed ):GetBlendColor(),
	},
	["G"] = {
		BloomColor = PhotonColor( 0, 255, 0 ):Blend( meshGreen ):GetBlendColor(),
		DrawColor = PhotonColor( 128, 255, 128 ):Blend( meshGreen ):GetBlendColor(),
	},
	["B"] = {
		BloomColor = PhotonColor( 0, 0, 255 ):Blend( meshBlue ):GetBlendColor(),
		DrawColor = PhotonColor( 0, 150, 255 ):Blend( meshBlue ):GetBlendColor(),
	},
	["A"] = {
		BloomColor = PhotonColor( 255, 100, 0 ):Blend( meshAmber ):GetBlendColor(),
		DrawColor = PhotonColor( 255, 180, 0 ):Blend( meshAmber ):GetBlendColor(),
	},
	["W"] = {
		BloomColor = PhotonColor( 128, 128, 255 ):Blend( meshWhite ):GetBlendColor(),
		DrawColor = PhotonColor( 255, 255, 255 ):Blend( meshWhite ):GetBlendColor(),
	},
	["SW"] = {
		BloomColor = PhotonColor( 255, 195, 175 ):Blend( meshSoftWhite ):GetBlendColor(),
		DrawColor = PhotonColor( 255, 245, 205 ):Blend( meshSoftWhite ):GetBlendColor(),
	},
	["M"] = {
		BloomColor = PhotonColor( 0, 150, 120 ):Blend( meshMiku ):GetBlendColor(),
		DrawColor = PhotonColor( 75, 225, 190 ):Blend( meshMiku ):GetBlendColor(),
	},
}

-- Ported verbatim from lua/photon-v2/meta/light_projected.lua's
-- `Light.States` table -- uses a single `Color` field.
local projWhite = { r = 255, g = 255, b = 255 }
local projSoftWhite = { r = 255, g = 235, b = 205 }
local projRed = { r = 255, g = 0, b = 0 }
local projBlue = { r = 0, g = 0, b = 255 }
local projGreen = { r = 0, g = 255, b = 0 }
local projAmber = { r = 255, g = 210, b = 0 }
local projMiku = { r = 0, g = 221, b = 192 }

Photon2.DefaultLightStatesProjected = {
	["~OFF"] = {
		Intensity = 0,
		IntensityTransitions = true,
	},
	["OFF"] = {
		Color = PhotonColor( 0, 0, 0 ),
	},
	["W"] = {
		Color = PhotonColor( 235, 235, 255 ):Blend( projWhite ):GetBlendColor(),
	},
	["SW"] = {
		Color = PhotonColor( 255, 225, 200 ):Blend( projSoftWhite ):GetBlendColor(),
	},
	["R"] = {
		Color = PhotonColor( 255, 0, 0 ):Blend( projRed ):GetBlendColor(),
	},
	["B"] = {
		Color = PhotonColor( 0, 0, 255 ):Blend( projBlue ):GetBlendColor(),
	},
	["A"] = {
		Color = PhotonColor( 255, 180, 0 ):Blend( projAmber ):GetBlendColor(),
	},
	["G"] = {
		Color = PhotonColor( 0, 255, 0 ):Blend( projGreen ):GetBlendColor(),
	},
	["M"] = {
		Color = PhotonColor( 0, 255, 222 ):Blend( projMiku ):GetBlendColor(),
	},
}
